import requests
from google import genai
import os
from main import app
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import re
from bs4 import BeautifulSoup

# Initialize Gemini Client (will use GEMINI_API_KEY from environment)
# Wait, genai.Client() automatically checks for GEMINI_API_KEY env variable,
# but we can pass it explicitly or leave it default.
api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

@app.task(name="tasks.generate_section_iterative")
def generate_section_iterative(article_id, project_id, section_order, heading_title, previous_content="", static_rules="", user_feedback=None):
    print(f"Yazım başladı: {heading_title} (Sıra: {section_order})")
    
    # Faz 1 Hafıza (Context) Kurulumu
    prompt = f"""
    Aşağıdaki kurallara kesinlikle uyarak bir blog yazısı bölümü yaz.
    
    KURAL ANAYASASI:
    {static_rules}
    
    BİR ÖNCEKİ BÖLÜM (Akıcılığı sağlamak için oku ama aynısını yazma):
    {previous_content}
    
    YAZILACAK BÖLÜMÜN BAŞLIĞI:
    {heading_title}
    
    Görevin: Sadece belirtilen başlık altındaki metni Türkçe olarak, zengin ve akıcı HTML formatında (p, strong, ul, li kullanarak) yaz. Başlığı metnin içine tekrar ekleme.
    """
    
    if user_feedback:
        prompt += f"""
        DİKKAT: Kullanıcı bu bölümün bir önceki halini beğenmedi ve şu geri bildirimi bıraktı: "{user_feedback}". 
        Yeni metni yazarken bu eleştiriyi kesinlikle dikkate al ve kurallara uymaya devam et.
        """
    
    # LLM Call using configurable model (defaults to gemini-2.5-flash-lite due to quota constraints)
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    response = client.models.generate_content(
        model=model_name,
        contents=prompt
    )
    generated_html = response.text
    
    # Calculate word count accurately from tag-stripped text
    from bs4 import BeautifulSoup
    plain_text = BeautifulSoup(generated_html, "html.parser").get_text()
    word_count = len(plain_text.split())
    
    # Report back to Next.js Internal API (Faz 1 Bearer Token)
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    payload = {
        "action": "section_complete",
        "articleId": article_id,
        "projectId": project_id,
        "order": section_order,
        "headingTitle": heading_title,
        "htmlContent": generated_html,
        "wordCount": word_count,
        "changeNote": f"Revizyon: {user_feedback}" if user_feedback else None
    }
    
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    
    if res.status_code == 200:
        print(f"Bölüm başarıyla kaydedildi: {heading_title}")
        return {"status": "success", "order": section_order}
    else:
        print(f"Hata! Veritabanına yazılamadı: {res.text}")
        raise Exception(f"Next.js internal API error: {res.text}")

# Gemini Yapılandırılmış Çıktı Şemaları
class FactItem(BaseModel):
    key: str = Field(description="Teknik parametrenin adı (örn: durability_class, density, fire_performance, standard)")
    value: str = Field(description="Doğrulanmış kesin değer (örn: Class 1-2, 730-830 kg/m3, NEN-EN 13501-1)")

class BrandEntityItem(BaseModel):
    category: str = Field(description="Kategori (distributors, certifications, test_institutions, standards)")
    name: str = Field(description="Varlık veya kurum adı (örn: KOMO, SKH, FSC, RVO, Sikkens)")

class RuleItem(BaseModel):
    type: str = Field(description="Kural tipi: FORBIDDEN_PHRASE, FACT_CORRECTION, REQUIRED, STYLE")
    value: str = Field(description="Kuralın kendisi (örn: 'Class 1' ifadesi yasak, 'cheap' kelimesi yasak, 'min 4000 words' zorunlu)")
    reason: str = Field(description="Kuralın var olma nedeni / gerekçesi")
    source_url: Optional[str] = Field(None, description="Eğer varsa kuralın türetildiği kaynak site URL'i")

class PillarItem(BaseModel):
    name: str = Field(description="İçerik silosu / kategori adı")
    scope: str = Field(description="Silonun kapsama alanı ve odak noktası")

class OutboundLinkItem(BaseModel):
    url: str = Field(description="Güvenilir dış bağlantı URL'i (örn: [https://www.skh.nl](https://www.skh.nl))")
    title: str = Field(description="Bağlantı başlığı veya kurum adı")
    usage_area: str = Field(description="Bu linkin hangi içeriklerde kullanılacağı talimatı")

class ConstitutionResponse(BaseModel):
    verified_facts: List[FactItem]
    brand_entities: List[BrandEntityItem]
    writing_instructions: Dict[str, Any] # {minWords: 4000, language: "nl", tone: "B2B technical"}
    generated_checklist: List[str] # Kalite kapısında kontrol edilecek siteye özel 15-20 maddelik checklist
    rules: List[RuleItem]
    pillars: List[PillarItem]
    outbound_links: List[OutboundLinkItem]


@app.task(name="tasks.derive_constitution")
def derive_constitution(project_id, site_audit_id, raw_audit_data_str):
    """
    SiteAudit ham verilerini alıp markaya özel Kural Anayasası türeten asenkron Celery görevi.
    """
    print(f"Kural Anayasası türetme işlemi başladı. Proje ID: {project_id}")
    
    prompt = f"""
    Aşağıdaki web sitesi denetim (SiteAudit) verilerini ve ham metin kırılımlarını analiz et.
    Bu markanın B2B veya içerik stratejisinde kullanmak üzere kurşungeçirmez bir 'Kural Anayasası' (Constitution) türet.
    
    Sitenin mevcut teknik parametrelerini (Facts), yasal zorunluluklarını (EUDR, FSC vb.), endüstri standartlarını (KOMO, SKH) çıkar.
    Eğer sitede teknik bir çelişki veya hatalı/jenerik pazarlama ifadesi varsa bunu tespit et ve 'FACT_CORRECTION' veya 'FORBIDDEN_PHRASE' kuralı olarak ekle.
    
    HAM SİTE AUDIT VERİLERİ:
    {raw_audit_data_str}
    """
    
    # 2026 model standardı: gemini-2.5-flash veya gemini-2.0-flash
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": ConstitutionResponse
        }
    )
    
    # Next.js internal webhook API'sine güvenli raporlama yap
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    payload = {
        "action": "constitution_complete",
        "projectId": project_id,
        "siteAuditId": site_audit_id,
        "constitution": response.text # JSON string olarak pasla
    }
    
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"Kural Anayasası başarıyla kaydedildi.")
        return {"status": "success", "projectId": project_id}
    else:
        raise Exception(f"Next.js internal API hatası: {res.text}")

class ArticlePlanItem(BaseModel):
    slug: str = Field(description="Makale URL slug'ı (örn: merbau-hout)")
    title: str = Field(description="Makale başlığı")
    contentType: str = Field(description="how-to, guide, comparison, local")
    focusKeyword: str = Field(description="Odak anahtar kelime")
    secondaryKeywords: List[str] = Field(description="Destekleyici anahtar kelimeler listesi")
    outline: List[str] = Field(description="H2 ve H3 başlık iskeleti listesi")
    order: int = Field(description="Üretim ve yayın sıralama numarası")

class LinkItem(BaseModel):
    source_slug: str = Field(description="Kaynak makalenin slug değeri")
    target_slug: str = Field(description="Hedef makalenin slug değeri")
    anchor_text: str = Field(description="Kullanılacak tam anchor text terimi")

class StrategyResponse(BaseModel):
    pillar_focus: str = Field(description="Stratejinin odaklandığı ana endüstriyel pillar")
    keyword_clusters: List[str] = Field(description="Hedeflenen anahtar kelime kümeleri")
    geo_targets: List[str] = Field(description="Varsa hedeflenen bölgesel coğrafi lokasyonlar")
    articles: List[ArticlePlanItem]
    internal_links: List[LinkItem]

@app.task(name="tasks.generate_strategy")
def generate_strategy(project_id, knowledge_base_str, site_audit_str):
    """
    KnowledgeBase ve SiteAudit verilerini potada eritip asenkron olarak içerik stratejisi ve iç link grafiği üreten görev.
    """
    print(f"Strateji ve İçerik Planı üretimi başladı. Proje ID: {project_id}")
    
    prompt = f"""
    Aşağıda bir sitenin analiz (SiteAudit) verileri ve marka için oluşturulmuş Kural Anayasası (KnowledgeBase) bulunmaktadır.
    Görevin: Bu bilgileri entegre eden tutarlı bir SEO İçerik Stratejisi, makale planları ve internal link grafiği üretmek.
    
    KURAL ANAYASASI:
    {knowledge_base_str}
    
    SİTE ANALİZ VERİLERİ (Özet):
    {site_audit_str}
    
    Lütfen markanın kurumsal yapısına uygun olarak yapılandırılmış JSON çıktısı dön. Ürettiğin her makalenin benzersiz bir 'slug'ı olmalı ve internal link'ler ('internal_links' listesinde) bu slug'ları kullanmalıdır.
    """
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": StrategyResponse
        }
    )
    
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    payload = {
        "action": "strategy_complete",
        "projectId": project_id,
        "strategy_data": response.text
    }
    
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"Strateji başarıyla üretildi ve API'ye iletildi.")
        return {"status": "success", "projectId": project_id}
        raise Exception(f"Webhook hatası: {res.text}")

# --- Phase 1.8 Schemas ---
class SEOAndWPProps(BaseModel):
    meta_title: str = Field(description="Max 60 karakterlik SEO başlığı")
    meta_description: str = Field(description="Max 135 karakterlik SEO açıklaması")
    wp_slug: str = Field(description="WordPress uyumlu URL slug")
    wp_category: str = Field(description="İçeriğin yayınlanacağı en uygun kategori adı")

class FAQItem(BaseModel):
    question: str = Field(description="B2B veya PAA odaklı teknik soru")
    answer: str = Field(description="Kural anayasasına dayalı kesin, net cevap")

class ImagePromptItem(BaseModel):
    section_order: int = Field(description="Görselin yerleştirileceği bölümün order numarası")
    prompt: str = Field(description="Midjourney/Imagen için fotogerçekçi B2B üretim promptu")
    alt_text: str = Field(description="SEO uyumlu görsel alt etiketi")

class ArticleComponentsResponse(BaseModel):
    seo_wp: SEOAndWPProps
    faqs: List[FAQItem]
    geo_citation_html: str = Field(description="AI atıfı ve GEO grounding için HTML blok")
    schema_json_ld: str = Field(description="Article ve FAQPage birleşik JSON-LD şeması stringi")
    image_prompts: List[ImagePromptItem]

@app.task(name="tasks.produce_article_factory")
def produce_article_factory(article_id: str, html_content: str, knowledge_base_str: str, project_id: str):
    """
    Üretilmiş olan makale metni (html_content) ve anayasa üzerinden
    yapılandırılmış çıktıları (SEO, FAQ, Schema, Görsel) oluşturur ve
    kantitatif kalite kapısını (Quality Gate) test eder.
    """
    print(f"[{article_id}] Makale Fabrikası çalışıyor...")
    
    # 1. Quality Gate: Kantitatif Ölçüm (Kelime sayısı, Hedef kelime density vs.)
    soup = BeautifulSoup(html_content, 'html.parser')
    text_content = soup.get_text(separator=' ')
    word_count = len(re.findall(r'\w+', text_content))
    
    # Kaba bir yasaklı kelime analizi (Mock implementation for now)
    # TODO: fetch actual forbidden phrases from Knowledge Base rules
    forbidden_issues = []
    
    passed_quality_gate = True
    if word_count < 300: # Example threshold
        passed_quality_gate = False
        forbidden_issues.append("Word count is too low (<300).")

    quality_gate_result = {
        "passed": passed_quality_gate,
        "score": 100 if passed_quality_gate else 40,
        "failures": forbidden_issues,
        "metrics": {
            "wordCount": word_count,
            "keywordDensity": 0.0  # calculate dynamically later
        }
    }
    
    # 2. Gemini Yapılandırılmış Çıktı
    prompt = f"""
    Aşağıda üretilmiş bir makalenin tam HTML metni ve markanın Kural Anayasası verilmiştir.
    
    Görevin: Bu makale için SEO başlığı, FAQ bloğu, Geo Reference (Citation) bloğu, 
    Article & FAQPage Schema JSON-LD'si ve Görsel Prompt'ları üretmek.
    
    KURAL ANAYASASI:
    {knowledge_base_str}
    
    MAKALE HTML METNİ:
    {html_content[:5000]}... (kesilmiş olabilir)
    
    Lütfen belirtilen şemaya (ArticleComponentsResponse) tam uyarak JSON çıktısı dön.
    """
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": ArticleComponentsResponse
        }
    )
    
    # 3. Webhook ile Next.js'e Yolla
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    payload = {
        "action": "production_complete",
        "articleId": article_id,
        "components": response.text,  # Zaten JSON string
        "qualityGateResult": quality_gate_result
    }
    
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"[{article_id}] Üretim başarıyla tamamlandı ve API'ye iletildi.")
        return {"status": "success", "articleId": article_id}
    else:
        raise Exception(f"Webhook hatası: {res.text}")

@app.task(name="tasks.publish_to_wordpress")
def publish_to_wordpress(article_id: str, wp_payload: dict, connection_config: dict):
    """
    WP REST API payload'unu hedefe fırlatır veya loglar.
    """
    print(f"[{article_id}] WordPress Publish tetiklendi.")
    
    is_mock = os.getenv("WP_MOCK_MODE", "true").lower() == "true"
    
    if is_mock:
        print("--- WP_MOCK_MODE AKTİF ---")
        print(f"Hedef URL: {connection_config.get('url')}/wp-json/wp/v2/posts")
        print(f"Kullanıcı/Auth: {connection_config.get('credentials')}")
        print(f"Gövde (Payload):\n{wp_payload}")
        print("--------------------------")
        return {"status": "mock_success", "articleId": article_id, "mocked": True}
    else:
        # Gerçek REST API isteği
        import base64
        creds = connection_config.get("credentials")
        encoded_creds = base64.b64encode(creds.encode('utf-8')).decode('utf-8')
        
        headers = {
            "Authorization": f"Basic {encoded_creds}",
            "Content-Type": "application/json"
        }
        
        wp_url = f"{connection_config.get('url')}/wp-json/wp/v2/posts"
        res = requests.post(wp_url, json=wp_payload, headers=headers)
        
        if res.status_code in [200, 201]:
            print(f"[{article_id}] WordPress'e başarıyla gönderildi.")
            return {"status": "success", "articleId": article_id, "wp_response": res.json()}
        else:
            raise Exception(f"WordPress API hatası ({res.status_code}): {res.text}")

# --- Phase 1.9 ---

@app.task(name="tasks.analyze_competitors")
def analyze_competitors(project_id):
    print(f"[{project_id}] Rakip otomasyonu başlatılıyor (SERP mock)...")
    import time
    time.sleep(2) # Sahte ağ beklemesi
    
    # Gerçek senaryoda bu adım Google Custom Search API veya DataForSEO ile doldurulur.
    is_mock = os.getenv("COMPETITOR_MOCK_MODE", "true").lower() == "true"
    
    competitors = [
        {
            "siteUrl": "https://www.rakip-b2b-timber.com",
            "domain": "rakip-b2b-timber.com",
            "source": "serp_automation",
            "domainRating": 65.4,
            "organicTraffic": 12500,
            "topKeywords": [{"keyword": "merbau durability class", "position": 2, "volume": 1200}, {"keyword": "hardwood supplier europe", "position": 4, "volume": 3500}],
            "contentGaps": ["sustainable sourcing merbau", "fsc certified hardwood imports", "b2b timber logistics"]
        },
        {
            "siteUrl": "https://www.wood-specialists.eu",
            "domain": "wood-specialists.eu",
            "source": "serp_automation",
            "domainRating": 58.1,
            "organicTraffic": 8200,
            "topKeywords": [{"keyword": "buy bilinga wood", "position": 1, "volume": 800}, {"keyword": "azobe sheet piling", "position": 3, "volume": 1500}],
            "contentGaps": ["azobe vs bilinga comparison", "waterworks timber specifications"]
        },
        {
            "siteUrl": "https://www.global-lumber.net",
            "domain": "global-lumber.net",
            "source": "serp_automation",
            "domainRating": 72.0,
            "organicTraffic": 45000,
            "topKeywords": [{"keyword": "wholesale tropical timber", "position": 5, "volume": 5000}, {"keyword": "meranti decking", "position": 2, "volume": 2200}],
            "contentGaps": ["meranti fire resistance", "tropical timber eu regulations"]
        }
    ]
    
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
    payload = {
        "action": "competitor_analysis_complete",
        "projectId": project_id,
        "competitors": competitors
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"[{project_id}] Rakip otomasyonu tamamlandı.")
        return {"status": "success", "projectId": project_id}
    else:
        raise Exception(f"Rakip analizi API hatası: {res.text}")

@app.task(name="tasks.run_gap_analysis")
def run_gap_analysis(project_id, competitor_keywords_str, existing_keywords_str):
    print(f"[{project_id}] Gap Analizi Başlatılıyor...")
    
    prompt = f"""
    Sen kıdemli bir B2B SEO Uzmanısın. Amacımız içerik boşluklarını (content gaps) bulmak.
    Aşağıda rakiplerin sıralama aldığı "top keywords" havuzu ve bizim projemizde şu an "ArticlePlan" içerisinde planlanmış "focusKeywords" listesi var.
    
    RAKİPLERİN KELİMELERİ:
    {competitor_keywords_str}
    
    BİZİM PLANLI KELİMELERİMİZ:
    {existing_keywords_str}
    
    Görevi: Bize ait listelerde OLMAYAN ama sektörel olarak çok değerli 4-5 adet yeni "fırsat" kelimesini bul.
    Çıktı formatı kesinlikle aşağıdaki şemaya uymalıdır (saf JSON, kod bloğu olmadan):
    [
      {{ "title": "Önerilen Makale Başlığı", "focusKeyword": "Odak Kelime", "type": "new_article" }},
      {{ "title": "Bunu da eklersen iyi olur", "focusKeyword": "Yan Kelime", "type": "lsi_suggestion" }}
    ]
    """
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={"response_mime_type": "application/json"}
    )
    
    import json
    try:
        gaps = json.loads(response.text)
    except Exception as e:
        gaps = [{"title": "Fallback Plan", "focusKeyword": "b2b tropical timber imports", "type": "new_article"}]
        
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
    payload = {
        "action": "gap_analysis_complete",
        "projectId": project_id,
        "gaps": gaps
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"[{project_id}] Gap analizi tamamlandı.")
        return {"status": "success", "gaps_found": len(gaps)}
    else:
        raise Exception(f"Gap analizi API hatası: {res.text}")

@app.task(name="tasks.retro_link_maintenance")
def retro_link_maintenance(project_id, article_id, new_article_slug, focus_keyword, current_html):
    print(f"[{article_id}] Retro link bakımı yapılıyor: '{focus_keyword}' kelimesi aranıyor...")
    
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(current_html, 'html.parser')
    
    modified = False
    # Kelime büyük/küçük harf duyarsız aramak için
    import re
    pattern = re.compile(f"\\b({re.escape(focus_keyword)})\\b", re.IGNORECASE)
    
    for text_node in soup.find_all(string=True):
        # A etiketinin içinde mi diye kontrol et
        if text_node.parent.name == 'a':
            continue
        # Headings (h1, h2, vb.) içinde değiştirmek SEO için risklidir, sadece p, li, span, div içindekileri değiştir
        if text_node.parent.name not in ['p', 'li', 'span', 'div', 'td']:
            continue
            
        text = str(text_node)
        if pattern.search(text):
            # Sadece İLK eşleşmeyi bulup değiştirelim
            match = pattern.search(text)
            start, end = match.span()
            matched_word = text[start:end]
            
            new_html = text[:start] + f'<a href="/blog/{new_article_slug}">{matched_word}</a>' + text[end:]
            
            # HTML elementini yeni yapıyla değiştir
            new_soup = BeautifulSoup(new_html, 'html.parser')
            text_node.replace_with(new_soup)
            modified = True
            break # Sadece bir link yeterli
            
    if not modified:
        print(f"[{article_id}] Kelime bulunamadı veya zaten linkli.")
        return {"status": "no_change"}
        
    updated_html = str(soup)
    
    nextjs_api_url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    auth_token = os.getenv("INTERNAL_SECRET_TOKEN")
    
    headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
    payload = {
        "action": "link_maintenance_complete",
        "articleId": article_id,
        "updatedHtml": updated_html
    }
    
    res = requests.post(nextjs_api_url, json=payload, headers=headers)
    if res.status_code == 200:
        print(f"[{article_id}] Retro link eklendi ve DB güncellendi.")
        return {"status": "success", "modified": True}
    else:
        raise Exception(f"Link retrofitting API hatası: {res.text}")
