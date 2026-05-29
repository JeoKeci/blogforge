# BlogForge — Decoupled Multi-Agent Content Platform
## Master Technical & Architectural Blueprint

> **ÖNEMLİ OKU-BENİ (DEVELOPER HANDOFF):** Bu doküman, BlogForge platformunun mimari tasarımını, veri şemasını, ajan topolojilerini ve aşamalı yol haritasını içeren tek ve eksiksiz **Single Source of Truth (Sanal Ana Referans)** kaynağıdır. Yarın sabah kim bilgisayarı açarsa açsın, bu dokümanı okuyarak projeyi sıfırdan ayağa kaldırabilir, tek bir database tablosunu bozmadan Faz 1'den Faz 3'e sistemi Lego gibi büyütebilir.

---

## 📐 Sistem Mimarisi & Topoloji (Decoupled Architecture)

BlogForge, CPU-yoğun AI, crawling ve veri analizi işlerini UI ve orkestrasyon katmanından tamamen izole eden, asenkron ve gevşek bağlı (decoupled) bir mimariye sahiptir.

```mermaid
graph TD
    %% Katmanlar ve Düğümler
    subgraph Frontend_Orchestrator [Next.js 15 App Router & Orchestrator]
        UI[Next.js UI & Editor]
        API_Client[Next.js API /api/projects]
        API_Internal[Next.js Internal Webhook /api/internal/jobs]
        Orchestrator[Pipeline Orchestrator & State Machine]
        SSE[SSE Progress Streamer]
    end

    subgraph Message_Queue [Message & State Cache]
        Redis[(Redis - Queue & Cache)]
    end

    subgraph Database_Layer [Transactional Store]
        Postgres[(PostgreSQL + Prisma)]
    end

    subgraph Asynchronous_Workers [Python Celery Agent Workers]
        CeleryWorker[Celery Worker Process]
        Agent_Auditor[Site Auditor Agent]
        Agent_Discoverer[Competitor Discoverer Agent]
        Agent_Writer[Iterative Section Writer Agent]
        Agent_SEO[SEO/GEO Quality Gate Agent]
    end

    subgraph External_Services [External Integrations]
        LLM_Gemini[Gemini API - Google]
        SEO_API[DataForSEO / Google Suggest]
        WP_REST[WordPress REST API]
    end

    %% İletişim Akışları
    UI -->|1. URL Gir/Onayla| API_Client
    API_Client -->|2. Durum Değişikliği & State Log| Postgres
    API_Client -->|3. Görevi Dispatch Et| Redis
    Redis -->|4. Task Çek & Çalıştır| CeleryWorker
    
    %% Celery Worker Ajan Tetiklemeleri
    CeleryWorker --> Agent_Auditor
    CeleryWorker --> Agent_Discoverer
    CeleryWorker --> Agent_Writer
    CeleryWorker --> Agent_SEO

    %% Ajanların Servis İletişimleri
    Agent_Auditor -->|Scrape / SEO API| SEO_API
    Agent_Discoverer -->|Competitor SERP Scrape| SEO_API
    Agent_Writer -->|Iterative Section Write| LLM_Gemini
    Agent_SEO -->|SEO Rules Check| LLM_Gemini
    
    %% Worker Next.js İletişimi (Internal Webhook)
    CeleryWorker -->|5. Bölüm Bitti / State Güncelle (HMAC/Bearer)| API_Internal
    API_Internal -->|6. Kalıcı State Commit| Postgres
    CeleryWorker -->|7. Anlık Log & Progress Yaz| Redis
    SSE -->|8. Anlık Progress Oku| Redis
    UI -->|9. SSE ile İzle| SSE
    
    %% Yayım Aşaması
    CeleryWorker -->|10. Draft Post Gönder| WP_REST
```

---

## 🗺️ Stratejik Yol Haritası (Fazlandırma)

"Geleceği düşünerek kurşungeçirmez mimariyi tasarla, bugünü yönetmek için en yalın halden başla." Veri tabanı şeması ve klasör yapısı Day 1'de **Faz 3 (Tam Kurşungeçirmezlik)** hedeflenerek kurulur; ancak ilk gün kod karmaşasında boğulmamak için kurallar ve kalkanlar aşamalı olarak devreye alınır.

| Kural / Modül | Faz 1: Çekirdek İskelet | Faz 1.5: Multi-Source & Audit | Faz 2: SaaS & Güvenlik | Faz 3: Tam Kurşungeçirmezlik |
| :--- | :--- | :--- | :--- |
| **Analiz & Denetim** | 100 Puanlık Skor Matrisi | Site Audit Otomasyonu | - |
| **Kaynak Yönetimi**| Çoklu Kaynak (Web, YT, IG)| - | - |
| **Yazım Modeli** | Bölüm Bazlı (Section-by-Section) | Gelişmiş Hafıza Yönetimi | - |
| **Hafıza (Context)** | Statik Kurallar + Son Bölüm | Rolling Context Özetleme | - |
| **Kuyruk / Worker** | Next.js + Python (Celery) | Çoklu Eşzamanlı İşçiler | - |
| **Güvenlik (Webhook)**| Statik Güvenli Token (Bearer) | HMAC-SHA256 İmzalama | Dual-Key Rotasyonu |
| **Eşzamanlılık (Lock)**| Tek İşçi (`-c 1`) (Kilit gerekmez) | Redis Redlock Kalkanı | - |
| **Şema Yönetimi** | Manuel Senkronizasyon | Dinamik JSON Şema Doğrulama| - |
| **Görsel Yönetimi** | Doğrudan Unsplash URL Gömme | - | Cloudflare R2 Side-Loading |
| **İçerik Kalite Kapısı**| Temel Kelime / Başlık Kontrolü | SEO Audit Otomasyonu | WP SEO Meta Doğrulama |
| **Hata Toleransı** | Standart Hata Loglama | JSON Auto-Repair | Smart Proxy Rotator |

---

## 🗄️ Database Şeması (Prisma Schema - Verbatim)

Aşağıdaki şema, multi-tenant SaaS yapısını destekleyecek `User`, `Project`, `CMSConnection` yapılarını ve checkpointing destekli bölüm bazlı üretim yapan `ArticleSection` tablosunu içerir. `prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String          @id @default(cuid())
  email         String          @unique
  name          String?
  password      String?         // Hashed password
  projects      Project[]
  cmsConnections CMSConnection[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

model Project {
  id            String        @id @default(cuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id])
  name          String
  siteUrl       String
  state         ProjectState  @default(CREATED)
  
  siteAudit     SiteAudit?
  sources       ContentSource[]
  competitors   Competitor[]
  strategy      Strategy?
  contentPlan   ContentPlan?
  articles      Article[]
  
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

enum ProjectState {
  CREATED
  SOURCES_ANALYZING
  SOURCES_ANALYZED
  SITE_AUDIT_RUNNING
  SITE_AUDIT_COMPLETE
  SITE_AUDIT_APPROVED
  COMPETITORS_DISCOVERING
  COMPETITORS_DISCOVERED
  COMPETITORS_APPROVED
  COMPETITOR_ANALYSIS_RUNNING
  COMPETITOR_ANALYSIS_COMPLETE
  STRATEGY_GENERATING
  STRATEGY_REVIEW
  STRATEGY_REVISION
  PLAN_APPROVED
  CONTENT_PRODUCTION
}

model SiteAudit {
  id                 String   @id @default(cuid())
  projectId          String   @unique
  project            Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  performanceScore   Float?
  seoScore           Float?
  accessibilityScore Float?
  mobileScore        Float?
  
  existingPages      Json     // Array of: {url, title, h1, wordCount, keywords}
  existingKeywords   Json     // Array of: {keyword, position, url}
  
  domain             String
  cms                String?  // e.g. "wordpress", "shopify"
  language           String?
  region             String?  // GEO target region (e.g. "TR")
  brandInfo          Json?    // {industry, targetAudience, toneOfVoice}
  auditMatrix        Json?    // 100-point audit: {totalScore, breakdown: {metadata, hierarchy, depth, geoEntity}}
  actionPlan         Json?    // AI-generated remediation steps: string[]
  
  rawData            Json?
  approvedAt         DateTime?
  createdAt          DateTime @default(now())
}

model Competitor {
  id               String   @id @default(cuid())
  projectId        String
  project          Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  siteUrl          String
  domain           String
  source           String   // "serp", "user_input", "content_similarity"
  
  domainRating     Float?
  organicTraffic   Int?
  totalKeywords    Int?
  topKeywords      Json?     // Array of: {keyword, position, volume}
  contentGaps      Json?     // Keywords they have but we lack
  topContent       Json?     // Array of: {url, title, backlinks, traffic}
  publishFrequency String?  // "daily", "weekly", "monthly"
  
  analyzed         Boolean  @default(false)
  approvedAt       DateTime?
  createdAt        DateTime @default(now())
}

model Strategy {
  id             String             @id @default(cuid())
  projectId      String             @unique
  project        Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  summary        String
  targetKeywords Json               // Keyword clusters
  contentPillars Json               // Content silos/categories
  geoTargets     Json               // GEO target specifications
  contentMix     Json               // {informational: 40, transactional: 30, local: 30}
  monthlyTarget  Int
  
  revisions      StrategyRevision[]
  version        Int                @default(1)
  approvedAt     DateTime?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
}

model StrategyRevision {
  id           String   @id @default(cuid())
  strategyId   String
  strategy     Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  
  userFeedback String
  changes      String
  version      Int
  createdAt    DateTime @default(now())
}

model ContentPlan {
  id            String   @id @default(cuid())
  projectId     String   @unique
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  articles      ArticlePlan[]
  approvedAt    DateTime?
  createdAt     DateTime @default(now())
}

model ArticlePlan {
  id               String   @id @default(cuid())
  contentPlanId    String
  contentPlan      ContentPlan @relation(fields: [contentPlanId], references: [id], onDelete: Cascade)
  
  order            Int
  title            String
  primaryKeyword   String
  secondaryKeywords Json
  searchIntent     String
  contentType      String    // "how-to", "listicle", "guide", "comparison", "local"
  targetWordCount  Int
  priority         String    // "quick-win", "medium-term", "long-term"
  geoTarget        String?
  outline          Json?     // Dynamic outline array
  
  article          Article?
  status           String    @default("planned") // planned, in_progress, produced, published
  createdAt        DateTime  @default(now())
}

model Article {
  id              String         @id @default(cuid())
  projectId       String
  project         Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  articlePlanId   String?        @unique
  articlePlan     ArticlePlan?   @relation(fields: [articlePlanId], references: [id])
  
  title           String
  slug            String
  metaDescription String
  htmlContent     String
  markdownContent String
  excerpt         String?
  
  focusKeyword    String
  seoScore        Float?
  readabilityScore Float?
  wordCount       Int
  
  featuredImage   Json?          // {url, alt, source}
  inlineImages    Json?          // Array of: {url, alt, source, position}
  
  state           ArticleState   @default(OUTLINE_DRAFT)
  
  cmsPostId       String?
  cmsPostUrl      String?
  publishedAt     DateTime?
  
  outlineApprovedAt DateTime?
  seoAuditPassedAt  DateTime?
  userApprovedAt    DateTime?
  
  versions        ArticleVersion[]
  sections        ArticleSection[]
  currentVersion  Int            @default(1)
  
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

enum ArticleState {
  OUTLINE_DRAFT
  OUTLINE_APPROVED
  WRITING
  WRITTEN
  SEO_AUDIT
  SEO_AUDIT_PASSED
  IMAGES_GENERATING
  PREVIEW_READY
  USER_APPROVED
  PUBLISHING
  PUBLISHED
}

model ArticleVersion {
  id          String   @id @default(cuid())
  articleId   String
  article     Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)
  version     Int
  content     String
  changeNote  String?
  createdAt   DateTime @default(now())
}

model ArticleSection {
  id              String   @id @default(cuid())
  articleId       String
  article         Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)
  
  headingTitle    String
  headingLevel    Int
  order           Int      // Section sequence number for recovery
  
  htmlContent     String
  markdownContent String
  wordCount       Int
  
  sources         Json?    // Sources / references used: [{title, url}]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([articleId, order])
}

model CMSConnection {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id])
  
  type         String    // "wordpress", "webflow", "ghost"
  name         String
  siteUrl      String
  credentials  String    /// @encrypted
  isActive     Boolean   @default(true)
  lastTestedAt DateTime?
  
  createdAt    DateTime  @default(now())
}

model ContentSource {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type          String   // "WEBSITE", "YOUTUBE", "INSTAGRAM", "CUSTOM"
  url           String?
  identifier    String?  // @handle, username, etc.
  displayName   String
  status        String   @default("PENDING") // PENDING, FETCHING, ANALYZED, FAILED
  extractedData Json?    // JSON with tone, audience, keywords, topics, recentItems
  errorMessage  String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

` olarak doğrudan kullanılabilir.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String          @id @default(cuid())
  email         String          @unique
  name          String?
  password      String?         // Hashed password
  projects      Project[]
  cmsConnections CMSConnection[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

model Project {
  id            String        @id @default(cuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id])
  name          String
  siteUrl       String
  state         ProjectState  @default(CREATED)
  
  siteAudit     SiteAudit?
  competitors   Competitor[]
  strategy      Strategy?
  contentPlan   ContentPlan?
  articles      Article[]
  
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

enum ProjectState {
  CREATED
  SITE_AUDIT_RUNNING
  SITE_AUDIT_COMPLETE
  SITE_AUDIT_APPROVED
  COMPETITORS_DISCOVERING
  COMPETITORS_DISCOVERED
  COMPETITORS_APPROVED
  COMPETITOR_ANALYSIS_RUNNING
  COMPETITOR_ANALYSIS_COMPLETE
  STRATEGY_GENERATING
  STRATEGY_REVIEW
  STRATEGY_REVISION
  PLAN_APPROVED
  CONTENT_PRODUCTION
}

model SiteAudit {
  id                 String   @id @default(cuid())
  projectId          String   @unique
  project            Project  @relation(fields: [projectId], references: [id])
  
  performanceScore   Float?
  seoScore           Float?
  accessibilityScore Float?
  mobileScore        Float?
  
  existingPages      Json     // Array of: {url, title, h1, wordCount, keywords}
  existingKeywords   Json     // Array of: {keyword, position, url}
  
  domain             String
  cms                String?  // e.g. "wordpress", "shopify"
  language           String?
  region             String?  // GEO target region (e.g. "TR")
  brandInfo          Json?    // {industry, targetAudience, toneOfVoice}
  
  rawData            Json?
  approvedAt         DateTime?
  createdAt          DateTime @default(now())
}

model Competitor {
  id               String   @id @default(cuid())
  projectId        String
  project          Project  @relation(fields: [projectId], references: [id])
  
  siteUrl          String
  domain           String
  source           String   // "serp", "user_input", "content_similarity"
  
  domainRating     Float?
  organicTraffic   Int?
  totalKeywords    Int?
  topKeywords      Json?     // Array of: {keyword, position, volume}
  contentGaps      Json?     // Keywords they have but we lack
  topContent       Json?     // Array of: {url, title, backlinks, traffic}
  publishFrequency String?  // "daily", "weekly", "monthly"
  
  analyzed         Boolean  @default(false)
  approvedAt       DateTime?
  createdAt        DateTime @default(now())
}

model Strategy {
  id             String             @id @default(cuid())
  projectId      String             @unique
  project        Project            @relation(fields: [projectId], references: [id])
  
  summary        String             @db.Text
  targetKeywords Json               // Keyword clusters
  contentPillars Json               // Content silos/categories
  geoTargets     Json               // GEO target specifications
  contentMix     Json               // {informational: 40, transactional: 30, local: 30}
  monthlyTarget  Int
  
  revisions      StrategyRevision[]
  version        Int                @default(1)
  approvedAt     DateTime?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
}

model StrategyRevision {
  id           String   @id @default(cuid())
  strategyId   String
  strategy     Strategy @relation(fields: [strategyId], references: [id])
  
  userFeedback String   @db.Text
  changes      String   @db.Text
  version      Int
  createdAt    DateTime @default(now())
}

model ContentPlan {
  id            String   @id @default(cuid())
  projectId     String   @unique
  project       Project  @relation(fields: [projectId], references: [id])
  
  articles      ArticlePlan[]
  approvedAt    DateTime?
  createdAt     DateTime @default(now())
}

model ArticlePlan {
  id               String   @id @default(cuid())
  contentPlanId    String
  contentPlan      ContentPlan @relation(fields: [contentPlanId], references: [id])
  
  order            Int
  title            String
  primaryKeyword   String
  secondaryKeywords Json
  searchIntent     String
  contentType      String    // "how-to", "listicle", "guide", "comparison", "local"
  targetWordCount  Int
  priority         String    // "quick-win", "medium-term", "long-term"
  geoTarget        String?
  outline          Json?     // Dynamic outline array
  
  article          Article?
  status           String    @default("planned") // planned, in_progress, produced, published
  createdAt        DateTime  @default(now())
}

model Article {
  id              String         @id @default(cuid())
  projectId       String
  project         Project        @relation(fields: [projectId], references: [id])
  articlePlanId   String?        @unique
  articlePlan     ArticlePlan?   @relation(fields: [articlePlanId], references: [id])
  
  title           String
  slug            String
  metaDescription String         @db.VarChar(160)
  htmlContent     String         @db.Text
  markdownContent String         @db.Text
  excerpt         String?        @db.Text
  
  focusKeyword    String
  seoScore        Float?
  readabilityScore Float?
  wordCount       Int
  
  featuredImage   Json?          // {url, alt, source}
  inlineImages    Json?          // Array of: {url, alt, source, position}
  
  state           ArticleState   @default(OUTLINE_DRAFT)
  
  cmsPostId       String?
  cmsPostUrl      String?
  publishedAt     DateTime?
  
  outlineApprovedAt DateTime?
  seoAuditPassedAt  DateTime?
  userApprovedAt    DateTime?
  
  versions        ArticleVersion[]
  sections        ArticleSection[]
  currentVersion  Int            @default(1)
  
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

enum ArticleState {
  OUTLINE_DRAFT
  OUTLINE_APPROVED
  WRITING
  WRITTEN
  SEO_AUDIT
  SEO_AUDIT_PASSED
  IMAGES_GENERATING
  PREVIEW_READY
  USER_APPROVED
  PUBLISHING
  PUBLISHED
}

model ArticleVersion {
  id          String   @id @default(cuid())
  articleId   String
  article     Article  @relation(fields: [articleId], references: [id])
  version     Int
  content     String   @db.Text
  changeNote  String?
  createdAt   DateTime @default(now())
}

model ArticleSection {
  id              String   @id @default(cuid())
  articleId       String
  article         Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)
  
  headingTitle    String
  headingLevel    Int
  order           Int      // Section sequence number for recovery
  
  htmlContent     String   @db.Text
  markdownContent String   @db.Text
  wordCount       Int
  
  sources         Json?    // Sources / references used: [{title, url}]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([articleId, order])
}

model CMSConnection {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id])
  
  type         String    // "wordpress", "webflow", "ghost"
  name         String
  siteUrl      String
  credentials  Json      // Field-level encryption zorunlu — @prisma-field-encryption veya uygulama katmanında AES-256-GCM kullanın. ASLA plaintext saklamayın.
  isActive     Boolean   @default(true)
  lastTestedAt DateTime?
  
  createdAt    DateTime  @default(now())
}
```

---

## 🛠️ Faz 1 (MVP) Kurulum & Çalıştırma Rehberi

Faz 1'i en sade, en hızlı şekilde ayağa kaldırmak için aşağıdaki adımları sırayla takip edin.

### Adım 1: Next.js 15 Projesini Initialize Etmek
Terminale şu komutları vererek temiz bir Next.js TypeScript projesi başlatın:
```bash
npx -y create-next-app@latest ./ --typescript --tailwind false --app --src-dir --import-alias "@/*" --eslint
```
Ardından Prisma ve gerekli bağımlılıkları ekleyin:
```bash
npm install @prisma/client next-auth@5.0.0-beta.25
npm install -D prisma typescript @types/node
```

### Adım 2: Database Ortamını Hazırlamak
`.env.local` dosyası içine PostgreSQL veri tabanı URL'inizi ekleyin ve Prisma'yı initialize edin:
```bash
npx prisma init
```
Yukarıda paylaşılan `schema.prisma` dosyasını `prisma/schema.prisma` içine yapıştırın ve ilk veritabanı push komutunu çalıştırın:
```bash
npx prisma db push
```

### Adım 3: Python Celery Worker Altyapısını Kurmak
Proje kök dizininde `/worker` adında bir klasör oluşturun. 

`worker/requirements.txt` dosyasını oluşturup bağımlılıkları ekleyin:
```text
celery==5.3.6
redis==5.0.1
requests==2.31.0
google-genai==1.16.0
pydantic==2.5.3
python-dotenv==1.0.0
beautifulsoup4==4.12.3
```

`worker/config.py` dosyasını Celery broker ayarları ile donatın:
```python
import os
from dotenv import load_dotenv

load_dotenv()

class CeleryConfig:
    broker_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    result_backend = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    task_serializer = "json"
    result_serializer = "json"
    accept_content = ["json"]
    timezone = "Europe/Istanbul"
    enable_utc = True
```

`worker/main.py` Celery instance bootstrapping:
```python
from celery import Celery
from config import CeleryConfig

app = Celery("blogforge_worker")
app.config_from_object(CeleryConfig)

# Görev tanımlarını import et
import tasks
```

### Adım 4: Faz 1 Ajan Görevi (tasks.py Skeleton)
`worker/tasks.py` dosyasına ilk bölüm bazlı yazım mekanizmasını (MVP sürümü) entegre edin:
```python
import requests
from google import genai
import os
from main import app

# API Key Konfigürasyonu
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
    
    # LLM Call
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt
    )
    generated_html = response.text
    
    # HTML tag'larından arındırılmış kelime sayısı (doğru hesaplama)
    from bs4 import BeautifulSoup
    plain_text = BeautifulSoup(generated_html, "html.parser").get_text()
    word_count = len(plain_text.split())
    
    # Next.js Internal API'sine raporlama (Faz 1 Bearer Token)
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
        raise Exception("Next.js internal API error")
```

### Adım 5: Next.js Internal Webhook API Endpoint (/api/internal/jobs/route.ts)
`src/app/api/internal/jobs/route.ts` dosyasını oluşturup Celery'den gelen verileri güvenle veri tabanına yazacak endpoint'i kurun:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const secretToken = process.env.INTERNAL_SECRET_TOKEN;
    
    // Faz 1 Güvenlik Kalkanı: Bearer Token kontrolü
    if (!authHeader || authHeader !== `Bearer ${secretToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { action, articleId, projectId, order, headingTitle, htmlContent, wordCount } = body;
    
    if (action === 'section_complete') {
      // 1. Bölümü veri tabanına yaz (Checkpoint)
      await prisma.articleSection.upsert({
        where: {
          articleId_order: {
            articleId,
            order
          }
        },
        update: {
          htmlContent,
          markdownContent: '', // MVP'de boş bırakılabilir veya HTML'den dönüştürülebilir
          wordCount
        },
        create: {
          articleId,
          order,
          headingTitle,
          headingLevel: 2, // Default H2
          htmlContent,
          markdownContent: '',
          wordCount
        }
      });
      
      // 2. Makalenin genel durumunu ve HTML birleşimini güncelle
      const sections = await prisma.articleSection.findMany({
        where: { articleId },
        orderBy: { order: 'asc' }
      });
      
      const mergedHtml = sections.map(s => `<h2>${s.headingTitle}</h2>\n${s.htmlContent}`).join('\n\n');
      const totalWordCount = sections.reduce((acc, curr) => acc + curr.wordCount, 0);
      
      // 3. Bölüm sayısını taslaktaki (outline) H2/H3 sayısıyla karşılaştır
      const articleWithPlan = await prisma.article.findUnique({
        where: { id: articleId },
        include: { articlePlan: true }
      });
      
      const outlineLength = (articleWithPlan?.articlePlan?.outline as any[])?.length || 0;
      const isComplete = sections.length === outlineLength;
      
      await prisma.article.update({
        where: { id: articleId },
        data: {
          htmlContent: mergedHtml,
          wordCount: totalWordCount,
          state: isComplete ? 'PREVIEW_READY' : 'WRITING'
        }
      });
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

---

## 🔒 Kalite Kapıları & 16-Shield Blueprint Özeti

Faydalı bir "hata bulma/mimari kontrol" matrisi olarak, projenin kalbini oluşturan 16 Yapısal Kalkan'ın özeti:

1. **Serverless Timeout Shield (Faz 1):** Next.js asla LLM beklemez; `HTTP 202` döner, işi asenkron Celery yürütür.
2. **State Checkpointing Shield (Faz 1):** `ArticleSection` tablosuna her H2 yazıldığında kaydedilir, çökmelerde kaldığı bölümden devam eder.
3. **DB Connection Choking Shield (Faz 1):** Mikro loglar PostgreSQL yerine Redis'te geçici tutulur.
4. **Rolling Context Window (Faz 1):** Sadece static kurallar + Section $i-1$ LLM'e beslenerek bağlam kayması engellenir.
5. **Redlock Distributed Lock (Faz 2):** Çoklu eşzamanlı worker'ların aynı bölümü mükerrer yazmasını engeller.
6. **Webhook HMAC Signatures (Faz 2):** Worker webhook POST isteklerini gövde bazlı şifreler, Rogue POST saldırılarını bitirir.
7. **Strict Context Isolation (Faz 1):** Statik kurallar prompt'un en tepesinde ham olarak korunur, özetlenmez.
8. **Schema Drift Guard (Faz 2):** Next.js TS tiplerini JSON şemasına derler, worker açılışta API'den bunu doğrulayarak ayağa kalkar.
9. **Hot-Edit Lockout (Faz 2):** Yazım esnasında Next.js arayüzündeki düzenleme modu salt okunur (read-only) kilitlenir.
10. **CF R2 Side-Loading (Faz 3):** Görselleri WP yerine önce bizim R2 alanımıza WebP atar, WP'ye sadece CDN linki gönderilir.
11. **Crawl Depth & Page Caps (Faz 1):** Bütçeyi korumak amacıyla taranacak maksimum sayfa limiti otonom yönetilir.
12. **Dual-Key Secret Rotation (Faz 3):** Webhook şifre değişikliklerinde eski worker'ların çökmesini 24 saat engeller.
13. **Smart Proxy Rotator (Faz 3):** Crawling sırasında IP blokajını aşmak için residential proxy rotasyonu yapar.
14. **JSON Auto-Repair (Faz 3):** Kırık LLM JSON çıktılarını `json-repair` ile otonom tamir eder.
15. **WP SEO Meta Verification (Faz 3):** Yoast/RankMath meta alanlarının kaymasını post-publish kontrolüyle düzeltir.
16. **Zombie Process Recycler (Faz 1):** `worker_max_tasks_per_child = 50` ile memory sızıntısı yapan headless süreçleri öldürüp temiz açar.

---

## 🔑 Geliştirici Çevre Değişkenleri Şablonu

Aşağıdaki çevre değişkenlerini `.env.local` (Next.js için) ve `.env` (Python Worker için) olarak kaydedin.

> **ÖNEMLİ:** `.env.local` ve `.env` dosyaları **asla git'e commit edilmemelidir**. Projenin `.gitignore` dosyasına bu satırları eklediğinizden emin olun:
> ```
> .env
> .env.local
> .env*.local
> ```
> Takım üyelerinin kolayca kurulum yapabilmesi için her iki dosyanın `.env.example` kopyasını (gerçek değerler olmadan) repoya ekleyin.

### Next.js (`.env.local`)
```env
# Database
DATABASE_URL="postgresql://postgres:sifre@localhost:5432/blogforge?schema=public"

# Redis
REDIS_URL="redis://localhost:6379/0"

# NextAuth
NEXTAUTH_SECRET="en-az-32-karakterli-rastgele-kod"
NEXTAUTH_URL="http://localhost:3000"

# Internal Security
INTERNAL_SECRET_TOKEN="mvp-icin-guclu-bir-statik-parola-1234"

# External API Keys (Faz 2/3)
DATAFORSEO_API_KEY="dataforseo-api-anahtari"
```

### Python Worker (`.env`)
```env
# Redis
REDIS_URL="redis://localhost:6379/0"

# Internal Next.js API URL
NEXTJS_INTERNAL_URL="http://localhost:3000/api/internal/jobs"
INTERNAL_SECRET_TOKEN="mvp-icin-guclu-bir-statik-parola-1234"

# AI Provider
GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
```

---

## 🚦 Bootstrap ve Çalıştırma Doğrulama Kontrol Listesi

Projenin çalıştığını doğrulamak için başka bir geliştiricinin yapması gerekenler:

1. **`.gitignore` ve `.env` Dosyalarını Hazırlamak:**
   `.env.example` dosyalarını referans alarak `.env.local` ve `worker/.env` dosyalarını oluşturun. `.gitignore`'un bu dosyaları dışladığını doğrulayın.

2. **CMS Credentials Şifrelemesini Kurmak:**
   `CMSConnection.credentials` alanındaki verileri plaintext olarak asla saklamamak için Faz 1'den itibaren uygulama katmanında şifreleme zorunludur:
   ```bash
   npm install @prisma-field-encryption/client
   ```
   Alternatif olarak kaydetme/okuma sırasında Node.js `crypto` modülü ile AES-256-GCM kullanılabilir.

3. **DB Ayaklandırma ve Kontrolü:**
   ```bash
   npx prisma db push
   npx prisma studio # Studio ile tabloların doğruluğunu tarayıcıda incele
   ```
4. **Celery Worker'ı Başlatma:**
   `worker/` klasörünün içindeyken:
   ```bash
   celery -A main worker --loglevel=info -c 1
   ```
   *Not: `--loglevel=info` çıktısında `tasks.generate_section_iterative` görevinin başarıyla register edildiğini görün.*
5. **Next.js Dev Server Çalıştırma:**
   ```bash
   npm run dev
   ```
6. **İlk Test Run Tetiklemesi:**
   Postman veya curl ile Next.js `/api/internal/jobs` webhook'unu `INTERNAL_SECRET_TOKEN` Bearer header'ı ile test POST isteği göndererek database upsert işleminin çalıştığını doğrulayın.

---

> **DOKÜMAN BİTİŞ NOTU:** Bu dosya, BlogForge projesinin yazılım mimarı imzalı resmi dokümantasyonudur. Gelecekte projeye dahil olacak tüm mühendisler buradaki aşamalı yol haritası ve yapısal kalkan kurallarına uymakla yükümlüdür.
