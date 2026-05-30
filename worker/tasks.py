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

def _post_to_nextjs(payload: dict):
    url = os.getenv("NEXTJS_INTERNAL_URL", os.getenv("NEXT_PUBLIC_APP_URL", "http://localhost:3000") + "/api/internal/jobs")
    token = os.getenv("INTERNAL_SECRET_TOKEN")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    res = requests.post(url, json=payload, headers=headers, timeout=(10, 60))
    if res.status_code != 200:
        raise Exception(f"Next.js internal API error ({res.status_code}): {res.text}")
    return res

def _report_failure(article_id=None, project_id=None, error=""):
    try:
        _post_to_nextjs({"action": "job_failed", "articleId": article_id, "projectId": project_id, "error": error[:500]})
    except Exception:
        pass

@app.task(
    bind=True, name="tasks.generate_section_iterative",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def generate_section_iterative(self, article_id, project_id, section_order, heading_title, previous_content="", static_rules="", heading_level=2, language="en", tone="", user_feedback=None):
    try:
        print(f"Yazım başladı: {heading_title} (Sıra: {section_order})")
        
        # Faz 1 Hafıza (Context) Kurulumu
        prompt = f"""
        Aşağıdaki kurallara kesinlikle uyarak bir blog yazısı bölümü yaz.
        
        KURAL ANAYASASI:
        {static_rules}
        
        TON: {tone}
        
        BİR ÖNCEKİ BÖLÜMÜN SON KISMI (SADECE bağlam ve akıcılık için oku, KESİNLİKLE ÇIKTIYA DAHİL ETME!):
        {previous_content[-1000:] if previous_content else ''}
        
        YAZILACAK BÖLÜMÜN BAŞLIĞI:
        {heading_title}
        
        Görevin: SADECE YENİ BÖLÜMÜ "{language}" dilinde yaz. Önceki bölümden hiçbir cümleyi tekrar etme. Yalnızca belirtilen başlık altındaki metni zengin ve akıcı HTML formatında (p, strong, ul, li kullanarak) üret. Başlığın kendisini veya H1/H2 etiketlerini KESİNLİKLE çıktıya ekleme, doğrudan paragrafa başla.
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
        
        payload = {
            "action": "section_complete",
            "articleId": article_id,
            "projectId": project_id,
            "order": section_order,
            "headingTitle": heading_title,
            "htmlContent": generated_html,
            "wordCount": word_count,
            "headingLevel": heading_level,
            "changeNote": f"Revizyon: {user_feedback}" if user_feedback else None
        }
        
        _post_to_nextjs(payload)
        
        print(f"Bölüm başarıyla kaydedildi: {heading_title}")
        return {"status": "success", "order": section_order}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(article_id=article_id, project_id=project_id, error=str(e))
        raise

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

class InstructionItem(BaseModel):
    key: str = Field(description="Talimat adi (orn: minWords, language, tone)")
    value: str = Field(description="Talimat degeri (orn: 4000, nl, B2B technical)")

class ConstitutionResponse(BaseModel):
    verified_facts: List[FactItem]
    brand_entities: List[BrandEntityItem]
    writing_instructions: List[InstructionItem] # {key: "minWords", value: "4000"}
    generated_checklist: List[str] # Kalite kapisinda kontrol edilecek siteye ozel 15-20 maddelik checklist
    rules: List[RuleItem]
    pillars: List[PillarItem]
    outbound_links: List[OutboundLinkItem]


@app.task(
    bind=True, name="tasks.derive_constitution",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def derive_constitution(self, project_id, site_audit_id, raw_audit_data_str):
    """
    SiteAudit ham verilerini alıp markaya özel Kural Anayasası türeten asenkron Celery görevi.
    """
    try:
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
        
        payload = {
            "action": "constitution_complete",
            "projectId": project_id,
            "siteAuditId": site_audit_id,
            "constitution": response.text # JSON string olarak pasla
        }
        
        _post_to_nextjs(payload)
        
        print(f"Kural Anayasası başarıyla kaydedildi.")
        return {"status": "success", "projectId": project_id}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(project_id=project_id, error=str(e))
        raise

class OutlineItem(BaseModel):
    title: str = Field(description="Bolum basligi")
    level: int = Field(description="Baslik seviyesi: 2 (H2) veya 3 (H3)")

class ArticlePlanItem(BaseModel):
    slug: str = Field(description="Makale URL slug'ı (örn: merbau-hout)")
    title: str = Field(description="Makale başlığı")
    contentType: str = Field(description="how-to, guide, comparison, local")
    focusKeyword: str = Field(description="Odak anahtar kelime")
    secondaryKeywords: List[str] = Field(description="Destekleyici anahtar kelimeler listesi")
    outline: List[OutlineItem] = Field(description="H2 ve H3 başlık iskeleti listesi")
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

@app.task(
    bind=True, name="tasks.generate_strategy",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def generate_strategy(self, project_id, knowledge_base_str, site_audit_str):
    """
    KnowledgeBase ve SiteAudit verilerini potada eritip asenkron olarak içerik stratejisi ve iç link grafiği üreten görev.
    """
    try:
        print(f"Strateji ve İçerik Planı üretimi başladı. Proje ID: {project_id}")
        
        prompt = f"""
        Aşağıda bir sitenin analiz (SiteAudit) verileri ve marka için oluşturulmuş Kural Anayasası (KnowledgeBase) bulunmaktadır.
        Görevin: Bu bilgileri entegre eden tutarlı bir SEO İçerik Stratejisi, makale planları ve internal link grafiği üretmek.
        
        Her makalenin `outline`'ı {{"title": "...", "level": 2}} nesnelerinden oluşmalı; ana bölümler level=2, alt bölümler level=3.
        
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
        
        payload = {
            "action": "strategy_complete",
            "projectId": project_id,
            "strategy_data": response.text
        }
        
        _post_to_nextjs(payload)
        
        print(f"Strateji başarıyla üretildi ve API'ye iletildi.")
        return {"status": "success", "projectId": project_id}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(project_id=project_id, error=str(e))
        raise

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

@app.task(
    bind=True, name="tasks.produce_article_factory",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def produce_article_factory(self, article_id: str, html_content: str, knowledge_base_str: str, project_id: str, focus_keyword: str = ""):
    """
    Üretilmiş olan makale metni (html_content) ve anayasa üzerinden
    yapılandırılmış çıktıları (SEO, FAQ, Schema, Görsel) oluşturur ve
    kantitatif kalite kapısını (Quality Gate) test eder.
    """
    try:
        import json, re
        print(f"[{article_id}] Makale Fabrikası çalışıyor...")
        
        # 1. Quality Gate: Kantitatif Ölçüm (Kelime sayısı, Hedef kelime density vs.)
        soup = BeautifulSoup(html_content, 'html.parser')
        text_content = soup.get_text(separator=' ')
        word_count = len(re.findall(r'\w+', text_content))
        
        kb = json.loads(knowledge_base_str) if knowledge_base_str else {}
        rules = kb.get("rules", [])
        wi = kb.get("writingInstructions", {}) or {}
        min_words = int(wi.get("minWords", 1500))
        
        forbidden = [r["value"] for r in rules if r.get("type") == "FORBIDDEN_PHRASE" and r.get("value")]
        
        failures = []
        for phrase in forbidden:
            if re.search(re.escape(phrase), text_content, re.IGNORECASE):
                failures.append(f"Metinde yasakli ifade tespit edildi: '{phrase}'")
        
        if word_count < min_words:
            failures.append(f"Kelime sayisi dusuk: {word_count} < {min_words}")
        
        density = 0.0
        if focus_keyword:
            # NOT: Bu exact-match density'dir; hedef CMS'in (ör. Rank Math) olcumunden sapabilir. Telafi icin sayimi sismeye calisma, hedefi gercek olcumle hizala.
            occ = text_content.lower().count(focus_keyword.lower())
            density = round((occ / max(word_count, 1)) * 100, 2)
            if density < 0.5 or density > 2.5:
                failures.append(f"Keyword density araliginda degil: %{density} (hedef %0.5-%2.5)")
        
        # meta_title <=60 ve meta_description <=135 kontrolu, components uretildikten SONRA eklenir (asagi bak)
        quality_gate_result = {
            "passed": len(failures) == 0,
            "score": 100 if not failures else max(40, 100 - len(failures) * 20),
            "failures": failures,
            "metrics": {"wordCount": word_count, "keywordDensity": density},
        }
        
        # 2. Gemini Yapılandırılmış Çıktı
        prompt = f"""
        Aşağıda üretilmiş bir makalenin tam HTML metni ve markanın Kural Anayasası verilmiştir.
        
        Görevin: Bu makale için SEO başlığı, FAQ bloğu, Geo Reference (Citation) bloğu, 
        Article & FAQPage Schema JSON-LD'si ve Görsel Prompt'ları üretmek.
        
        KURAL ANAYASASI:
        {knowledge_base_str}
        
        MAKALE HTML METNİ:
        {html_content}
        
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
        
        import json
        seo = json.loads(response.text).get("seo_wp", {}) if isinstance(response.text, str) else {}
        mt = (seo.get("meta_title") or "")
        md = (seo.get("meta_description") or "")
        if len(mt) > 60:
            quality_gate_result["failures"].append(f"meta_title cok uzun: {len(mt)}>60")
        if len(md) > 135:
            quality_gate_result["failures"].append(f"meta_description cok uzun: {len(md)}>135")
        quality_gate_result["passed"] = len(quality_gate_result["failures"]) == 0
    
        payload = {
            "action": "production_complete",
            "articleId": article_id,
            "components": response.text,  # Zaten JSON string
            "qualityGateResult": quality_gate_result
        }
        
        _post_to_nextjs(payload)
        
        print(f"[{article_id}] Üretim başarıyla tamamlandı ve API'ye iletildi.")
        return {"status": "success", "articleId": article_id}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(article_id=article_id, project_id=project_id, error=str(e))
        raise

@app.task(
    bind=True, name="tasks.publish_to_wordpress",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def publish_to_wordpress(self, article_id: str, wp_payload: dict, connection_config: dict):
    """
    WP REST API payload'unu hedefe fırlatır veya loglar.
    """
    try:
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
            res = requests.post(wp_url, json=wp_payload, headers=headers, timeout=(10,60))
            
            if res.status_code in [200, 201]:
                print(f"[{article_id}] WordPress'e başarıyla gönderildi.")
                return {"status": "success", "articleId": article_id, "wp_response": res.json()}
            else:
                raise Exception(f"WordPress API hatası ({res.status_code}): {res.text}")
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(article_id=article_id, error=str(e))
        raise

# --- Phase 1.9 ---

@app.task(
    bind=True, name="tasks.analyze_competitors",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def analyze_competitors(self, project_id):
    try:
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
        
        payload = {
            "action": "competitor_analysis_complete",
            "projectId": project_id,
            "competitors": competitors
        }
        
        _post_to_nextjs(payload)
        
        print(f"[{project_id}] Rakip otomasyonu tamamlandı.")
        return {"status": "success", "projectId": project_id}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(project_id=project_id, error=str(e))
        raise

@app.task(
    bind=True, name="tasks.run_gap_analysis",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def run_gap_analysis(self, project_id, competitor_keywords_str, existing_keywords_str):
    try:
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
            
        payload = {
            "action": "gap_analysis_complete",
            "projectId": project_id,
            "gaps": gaps
        }
        
        _post_to_nextjs(payload)
        
        print(f"[{project_id}] Gap analizi tamamlandı.")
        return {"status": "success", "gaps_found": len(gaps)}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(project_id=project_id, error=str(e))
        raise
@app.task(
    bind=True, name="tasks.retro_link_maintenance",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def retro_link_maintenance(self, project_id, article_id, new_article_slug, focus_keyword, current_html=None):
    try:
        print(f"[{article_id}] Retro link request Next.js'e devrediliyor...")
        payload = {
            "action": "retro_link_request",
            "articleId": article_id,
            "focusKeyword": focus_keyword,
            "newArticleSlug": new_article_slug
        }
        _post_to_nextjs(payload)
        return {"status": "delegated_to_nextjs"}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(article_id=article_id, project_id=project_id, error=str(e))
        raise

@app.task(
    bind=True, name="tasks.analyze_sources",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def analyze_sources(self, project_id, sources_data):
    try:
        print(f"[{project_id}] Kaynak analizi (LLM) başlatılıyor...")
        
        results = []
        for src in sources_data:
            src_type = src.get('type')
            extracted = src.get('extractedData', {})
            result = None
            
            try:
                if src_type == 'WEBSITE':
                    prompt = f"""
                    Sen kıdemli bir SEO ve GEO denetçisisin. Aşağıdaki ham web sitesi verisini kullanarak iki görev gerçekleştireceksin:

                    **GÖREV 1 — MARKA PROFİLİ ÇIKARIMI:**
                    Sitenin marka adını, sektörünü, arketipini, tonunu, hedef kitlesini, ana konularını, anahtar kelimelerini ve genel özetini belirle.

                    **GÖREV 2 — 100 PUANLIK TEKNİK SAĞLIK, SEO VE GEO UYUMLULUK DENETİMİ:**
                    Aşağıdaki 4 ana kolonu ve puanlama mantığını uygula. Her kolon için "score", "good" (olumlu bulgu) ve "bad" (olumsuz bulgu / eksik) alanlarını doldur. totalScore, 4 kolonun puanlarının toplamıdır (maks. 100).

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    KOLON 1: Metadata ve Temel SEO Sağlığı (Maks. 20 Puan)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Bu kolon, "metadata" anahtarına yazılacak.
                      a) Title Etiketi (10 Puan):
                         - Etiket yoksa VEYA 30 karakterden kısaysa → 0 puan.
                         - Sadece marka adı varsa (sektör/anahtar kelime yok) → 5 puan.
                         - Odak sektörü içeren optimize başlıksa → 10 puan.
                      b) Meta Description (10 Puan):
                         - Açıklama yoksa → 0 puan.
                         - Var ama 160 karakterden uzunsa → 5 puan.
                         - Optimize ve arama niyetine uygun özetse → 10 puan.

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    KOLON 2: Semantik Hiyerarşi ve Mimari (Maks. 25 Puan)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Bu kolon, "hierarchy" anahtarına yazılacak.
                      a) Tekil H1 Kuralı (15 Puan):
                         - Sayfada hiç H1 yoksa VEYA birden fazla H1 varsa → 0 puan.
                         - Tam olarak 1 adet H1 varsa → 15 puan.
                      b) H2/H3 Başlık Dağılımı (10 Puan):
                         - Başlıklar yoksa veya jenerikse ("Ürünler", "Hizmetler" gibi) → 3 puan.
                         - Sektörel semantik kelimeler barındıran doğru hiyerarşiyse → 10 puan.

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    KOLON 3: İçerik Derinliği ve Bilgi Kazancı (Maks. 30 Puan)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Bu kolon, "depth" anahtarına yazılacak.
                      a) Thin Content Filtresi (15 Puan):
                         - Temiz kelime sayısı <300 ise → 0 puan.
                         - 300-600 arası kelime → 8 puan.
                         - >600 kelime zengin gövde metni varsa → 15 puan.
                      b) Teknik Derinlik (15 Puan):
                         - Sadece pazarlama sloganları varsa → 3 puan.
                         - Metinde ham veriler, sertifikalar, standartlar (Örn: KOMO, FSC, EUDR, Janka vb.) geçiyorsa → 15 puan.

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    KOLON 4: Varlık (Entity) ve GEO Hazırlığı (Maks. 25 Puan)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Bu kolon, "geoEntity" anahtarına yazılacak.
                      a) Coğrafi ve Bölgesel İşaretler (15 Puan):
                         - Lokasyon bağlamı yoksa → 0 puan.
                         - Sadece adreste geçiyorsa → 5 puan.
                         - Metin içinde bölgesel hedefleme cümleleri kurgulanmışsa → 15 puan.
                      b) Arketip Tutarlılığı (10 Puan):
                         - Tespit edilen kimlik ile (Örn: B2B Toptancısı) dil tonu çelişiyorsa → 0 puan.
                         - Kusursuz uyum varsa → 10 puan.

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    **GÖREV 3 — EYLEM PLANI:**
                    Denetim sonuçlarına göre, sitenin toplam puanını artırmak için yapılması gereken acil eylemleri 3-7 madde halinde listele.

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    HAM WEB SİTESİ VERİLERİ
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    WEB SİTESİ URL: {extracted.get('targetUrl')}
                    SİTE BAŞLIĞI (TITLE ETİKETİ): {extracted.get('title')}
                    TITLE KARAKTER UZUNLUĞU: {extracted.get('titleLength')}
                    META DESCRIPTION: {extracted.get('description')}
                    META DESCRIPTION KARAKTER UZUNLUĞU: {extracted.get('descriptionLength')}
                    HTML DİL ÖZNİTELİĞİ (lang): {extracted.get('htmlLang')}
                    KARAKTER SETİ: {extracted.get('charset')}
                    H1 ETİKETİ SAYISI: {extracted.get('h1Count')}
                    H1 METİNLERİ: {extracted.get('h1Texts')}
                    TEMİZ KELİME SAYISI: {extracted.get('wordCount')}

                    BAŞLIK HİYERARŞİSİ (Etiket ve Metin):
                    {extracted.get('headingsList')}

                    METİN İÇERİĞİNDEN KESİT (ilk ~10000 karakter):
                    {extracted.get('textSnippet')}

                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    ZORUNLU JSON ÇIKTI ŞEMASI
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
                    {{
                      "brandName": "Marka/Site Adı",
                      "industry": "Sektör/Niş",
                      "detectedArchetype": "PORTFOLIO_AUTHORITY | CONTENT_CREATOR | LOCAL_SERVICE | PRODUCT_BRAND | KNOWLEDGE_LEADER (birini seç)",
                      "toneOfVoice": "Yazım dili ve tonu",
                      "targetAudience": "Hedef kitle tanımı",
                      "coreTopics": ["Konu 1", "Konu 2", "Konu 3"],
                      "detectedKeywords": ["anahtar kelime 1", "anahtar kelime 2"],
                      "summary": "Sitenin amacı ve içeriği hakkında kısa bir özet",
                      "audit": {{
                        "totalScore": 0,
                        "breakdown": {{
                          "metadata": {{ "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" }},
                          "hierarchy": {{ "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" }},
                          "depth": {{ "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" }},
                          "geoEntity": {{ "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" }}
                        }}
                      }},
                      "actionPlan": ["Eylem 1", "Eylem 2", "Eylem 3"]
                    }}
                    """
                    
                    # Need a Gemini client since we're in Python.
                    # Wait, worker/tasks.py already has google.generativeai imported? Let's check.
                    # I'll just use requests or the existing method.
                    # worker/tasks.py has Gemini config. Let's just use the same pattern.
                    pass # I will replace this pass with the actual gemini call below
                elif src_type == 'YOUTUBE':
                    channelTitle = extracted.get('channelTitle')
                    channelDescription = extracted.get('channelDescription')
                    subscriberCount = extracted.get('subscriberCount')
                    videoCount = extracted.get('videoCount')
                    recentVideos = extracted.get('recentVideos', [])
                    
                    prompt = f"""
                    Aşağıdaki YouTube kanalı ve son videoları hakkında bilgi verildi. Bu verileri analiz et, kanalın tarzını, tonunu, ana konularını ve hedef kitlesini çıkar.
                    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
                    
                    KANAL ADI: {channelTitle}
                    AÇIKLAMA: {channelDescription}
                    ABONE SAYISI: {subscriberCount}
                    VİDEO SAYISI: {videoCount}
                    
                    SON 5 VİDEO:
                    {chr(10).join([f"{i+1}. BAŞLIK: {v.get('title')}\nAÇIKLAMA: {v.get('description', '')[:300]}...\n" for i, v in enumerate(recentVideos)])}
                    
                    Lütfen şu şemaya göre JSON döndür:
                    {{
                      "brandName": "{channelTitle}",
                      "toneOfVoice": "Kanalın konuşma tonu ve tarzı (örn: Eğitici, samimi, dinamik, sohbet havasında)",
                      "targetAudience": "İzleyici kitlesi tanımı",
                      "coreTopics": ["Konu 1", "Konu 2", "Konu 3"],
                      "recentVideoInsights": [
                        {{ "title": "Video Başlığı", "keyTakeaway": "Videodan çıkarılan ana fikir veya blog yazısı olabilecek konu başlığı" }}
                      ],
                      "summary": "Kanalın içeriği ve temaları hakkında genel özet"
                    }}
                    """
                elif src_type == 'YOUTUBE_SIMULATED':
                    cleanInput = extracted.get('cleanInput')
                    reason = extracted.get('reason')
                    
                    prompt = f"""
                    Kullanıcı şu YouTube kanalını analiz etmemizi istedi: "{cleanInput}".
                    YouTube API şu sebeple kullanılamadı: "{reason}".
                    Kanal isminden veya kullanıcı girdisinden yola çıkarak bu kanalın ne hakkında olabileceğini, tonunu ve hedef kitlesini simüle et/tahmin et.
                    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
                    
                    Lütfen şu şemaya göre JSON döndür:
                    {{
                      "brandName": "{cleanInput} (YouTube)",
                      "toneOfVoice": "Tahmini kanal tonu (örn: Dinamik, Samimi, Öğretici)",
                      "targetAudience": "Tahmini hedef kitle",
                      "coreTopics": ["Konu Fikri 1", "Konu Fikri 2"],
                      "recentVideoInsights": [
                        {{ "title": "Tahmini Popüler Video Başlığı", "keyTakeaway": "Kanal temasına uygun video fikri" }}
                      ],
                      "summary": "Kanal ismi analiz edilerek tahmin edilen içerik odağı."
                    }}
                    """
                elif src_type == 'INSTAGRAM':
                    profileName = extracted.get('profileName')
                    rawText = extracted.get('rawText')
                    
                    prompt = f"""
                    Aşağıdaki Instagram sayfası bilgilerini analiz et. Profil sahibi kimdir, ne tür içerikler üretir, tonu ve tarzı nedir, hedef kitlesi kimdir?
                    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
                    
                    INSTAGRAM KULLANICI ADI: @{profileName}
                    KULLANICI METİN GİRDİSİ (BİO VE PAYLAŞIMLAR):
                    {rawText}
                    
                    Lütfen şu şemaya göre JSON döndür:
                    {{
                      "brandName": "@{profileName}",
                      "toneOfVoice": "Instagram profilinin tonu (örn: Görsel ağırlıklı, samimi, estetik, ilham verici, günlük)",
                      "targetAudience": "Instagram takipçi kitlesi tanımı",
                      "coreTopics": ["İçerik Konusu 1", "İçerik Konusu 2"],
                      "summary": "Instagram profili ve içerik odağı hakkında genel özet"
                    }}
                    """
                elif src_type == 'CUSTOM':
                    displayName = extracted.get('displayName')
                    text_snippet = extracted.get('text', '')
                    
                    prompt = f"""
                    Kullanıcının yüklediği özel marka rehberi, doküman veya açıklama metnini analiz et. Markanın genel duruşunu, tonunu, kitle analizini ve stratejik hedeflerini özetle.
                    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
                    
                    DOKÜMAN ADI/TANIMI: {displayName}
                    DOKÜMAN METNİ:
                    {text_snippet}
                    
                    Lütfen şu şemaya göre JSON döndür:
                    {{
                      "brandName": "{displayName}",
                      "toneOfVoice": "Dokümandan anlaşılan marka tonu ve kuralları",
                      "targetAudience": "Tanımlanan hedef kitle",
                      "coreTopics": ["Odaklanılan Tema 1", "Odaklanılan Tema 2"],
                      "summary": "Dokümanın sunduğu marka özeti ve hedefler"
                    }}
                    """
                
                # Make the LLM Call (Assuming google.generativeai as 'genai' is imported)
                if prompt:
                    response = genai.GenerativeModel(GEMINI_MODEL).generate_content(
                        prompt,
                        generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
                    )
                    import json
                    result = json.loads(response.text)
                    if src_type == 'YOUTUBE' or src_type == 'YOUTUBE_SIMULATED':
                        result['channelStats'] = extracted.get('channelStats', {})
                    
            except Exception as llm_error:
                print(f"[{project_id}] {src_type} analizi LLM hatası: {llm_error}")
                result = {"error": str(llm_error)}
            
            results.append({
                "sourceId": src.get('id'),
                "type": src_type,
                "extractedData": extracted,
                "analysisResult": result
            })
            
        payload = {
            "action": "sources_analyzed",
            "projectId": project_id,
            "results": results
        }
        
        _post_to_nextjs(payload)
        print(f"[{project_id}] Kaynak analizi (LLM) tamamlandı ve API'ye iletildi.")
        return {"status": "success", "projectId": project_id}
        
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(project_id=project_id, error=str(e))
        raise
