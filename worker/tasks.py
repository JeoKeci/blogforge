import requests
from google import genai
import os
from main import app
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

# Initialize Gemini Client (will use GEMINI_API_KEY from environment)
# Wait, genai.Client() automatically checks for GEMINI_API_KEY env variable,
# but we can pass it explicitly or leave it default.
api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

@app.task(name="tasks.generate_section_iterative")
def generate_section_iterative(article_id, project_id, section_order, heading_title, previous_content="", static_rules=""):
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
        "wordCount": word_count
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
