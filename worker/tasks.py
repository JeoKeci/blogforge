import requests
from google import genai
import os
from main import app

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
