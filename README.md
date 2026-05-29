# BlogForge — Decoupled Multi-Agent Content Platform

## Master Technical & Architectural Blueprint (v2 — Faz 1.5 → 2)

> **ÖNEMLİ OKU-BENİ (DEVELOPER HANDOFF):** Bu doküman BlogForge'un mimari tasarımını, ajan topolojisini, veri şemasını ve aşamalı yol haritasını içeren tek **Single Source of Truth** kaynağıdır. Sistem önce tek-kullanıcı (kişisel) çalışır, sonra çok-kiracılı (multi-tenant) bir SaaS'a açılır. Kurşungeçirmez *şekil* Day 1'de kurulur; *kurallar* aşamalı devreye alınır.

> **v2 NOTU:** Bu sürüm, manuel içerik üretim sürecimizin (bkz. `scratch/ultimate-fbr-master-strategy.md`) sisteme nasıl çevrileceğini netleştirir ve Faz 1.5 ile Faz 2 arasını **1.6 → 1.9** olarak detaylandırır.

---

## 🧭 Sistem Felsefesi

Üç ilke tüm fazlamayı yönetir:

1. **Grounding her şeyden önce gelir.** B2B teknik bir markada AI'ın bir teknik veriyi (durability class, ASE, density) uydurması "kötü içerik" değil, **itibar kaybıdır.** Yazım motoru, doğrulanmış ve siteye özel kurallarla beslenmeden tek kelime yazmaz.
2. **Kurallar türetilir, elle yazılmaz.** Sistem siteyi analiz eder ve "bu site için içerik kuralları şunlardır" diye kanıta dayalı bir **Kural Anayasası** üretir. İnsanın rolü bu anayasayı *yazmak* değil, *onaylamak/düzeltmek*.
3. **Her modül tek bir temiz arayüzle (seam) bağlanır.** Bir modülün çıktısı, sonrakinin standart girdi paketidir. Bu sayede sıralama bile esner ve geliştirmeler "tık tık" eklenir, refactor gerektirmez.

---

## 📐 Sistem Mimarisi & Topoloji (Decoupled Architecture)

CPU-yoğun AI, crawling ve veri analizi işleri; UI ve orkestrasyon katmanından asenkron ve gevşek bağlı (decoupled) biçimde izole edilir.

```
graph TD
    subgraph Frontend_Orchestrator [Next.js App Router & Orchestrator]
        UI[Next.js UI & Editor]
        API_Client[Next.js API /api/projects]
        API_Internal[Internal Webhook /api/internal/jobs]
        Orchestrator[Pipeline Orchestrator & State Machine]
        SSE[SSE Progress Streamer]
    end

    subgraph Message_Queue [Message & State Cache]
        Redis[(Redis - Queue & Cache)]
    end

    subgraph Database_Layer [Transactional Store]
        DB[(SQLite -> PostgreSQL + Prisma)]
    end

    subgraph Asynchronous_Workers [Python Celery Agent Workers]
        CeleryWorker[Celery Worker Process]
        Agent_Auditor[Site Auditor Agent]
        Agent_Constitution[Constitution Deriver Agent]
        Agent_Strategist[Strategy & Plan Agent]
        Agent_Writer[Iterative Section Writer Agent]
        Agent_QualityGate[SEO/GEO Quality Gate Agent]
        Agent_Competitor[Competitor & Gap Agent]
    end

    subgraph External_Services [External Integrations]
        LLM[Gemini API]
        SEO_API[DataForSEO / Google Suggest]
        IMG[Unsplash / Stock + AI Image Gen]
        WP_REST[WordPress REST API]
    end

    UI -->|URL gir/onayla| API_Client
    API_Client -->|State log| DB
    API_Client -->|Görevi dispatch| Redis
    Redis -->|Task çek| CeleryWorker

    CeleryWorker --> Agent_Auditor
    CeleryWorker --> Agent_Constitution
    CeleryWorker --> Agent_Strategist
    CeleryWorker --> Agent_Writer
    CeleryWorker --> Agent_QualityGate
    CeleryWorker --> Agent_Competitor

    Agent_Auditor -->|Scrape / SEO API| SEO_API
    Agent_Constitution -->|Kural türetme| LLM
    Agent_Strategist -->|Strateji üretimi| LLM
    Agent_Writer -->|Bölüm yazımı| LLM
    Agent_Writer -->|Görsel| IMG
    Agent_QualityGate -->|Kural kontrolü| LLM
    Agent_Competitor -->|SERP / KW data| SEO_API

    CeleryWorker -->|State güncelle HMAC/Bearer| API_Internal
    API_Internal -->|Kalıcı commit| DB
    CeleryWorker -->|Anlık log| Redis
    SSE -->|Progress oku| Redis
    UI -->|SSE ile izle| SSE
    CeleryWorker -->|Draft gönder| WP_REST
```

---

## 🔄 İçerik Üretim Akışı (Faz Veri Akışı)

Mantıksal akış — her ok bir öncekinin çıktısını girdi olarak alır. İnsan onay kapıları ve gap-analizi geri besleme döngüsü dahil:

```
flowchart TD
    A[Site URL] --> B[Faz 1.5: Site Audit]
    B --> C[Faz 1.6: Kural Anayasasi Turetme]
    C -->|insan onayi/duzeltme| D[Onayli Bilgi Tabani + Checklist]
    D --> E[Faz 1.7: Strateji + Icerik Plani + Link Grafigi]
    E -->|insan onayi| F[Onayli Plan]
    F --> G[Faz 1.8: Uretim Hatti - section by section]
    G --> H[Kalite Kapisi - 1.6 checklistine gore]
    H -->|fail| G
    H -->|pass + preview onayi| I[WordPress Draft]
    I --> J[Faz 1.9: Gap Analizi + Editoryel Iterasyon]
    J -->|yeni post / edit onerisi| E
    K[Faz 1.9: Rakip Verisi] -. besler .-> E
```

---

## 🗺️ Stratejik Yol Haritası (Yeni Fazlandırma)

| Modül / Yetenek | Faz 1.5.5 (Önkoşul) | Faz 1.6 Grounding | Faz 1.7 Plan | Faz 1.8 Üretim | Faz 1.9 İterasyon | Faz 2 SaaS |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tenant Şekli (Org/Membership)** | ✅ Şema + kişisel-org | — | kullanılır | kullanılır | kullanılır | enforcement |
| **Kural Anayasası (siteye özel)** | — | ✅ AI türetir | beslenir | uygulanır | revize edilir | per-tenant onboarding |
| **Strateji & İçerik Planı** | — | — | ✅ | uygulanır | gap ile güncellenir | — |
| **Internal Link Grafiği** | — | — | ✅ plan | yerleştirilir | bakım | — |
| **Yazım Motoru (output contract)** | — | — | — | ✅ | re-write | — |
| **Kalite Kapısı (kantitatif)** | — | checklist üretilir | — | ✅ enforce | re-run | — |
| **Görsel (AI + Stok, pluggable)** | — | — | — | ✅ | — | — |
| **WordPress Publish (Publisher seam)** | — | — | — | ✅ draft | re-sync | — |
| **Rakip Otomasyonu** | — | — | manuel giriş | — | ✅ otomasyon | yüksek değer |
| **Gap-Analizi Döngüsü** | — | — | — | — | ✅ | — |
| **Auth (Credentials+JWT) & Middleware** | — | — | — | — | — | ✅ |
| **Rol Enforcement & Davet** | şema hazır | — | — | — | — | ✅ |
| **Billing-ready kancalar** | — | — | — | — | — | ✅ |

---

# 🔬 Faz Detayları

## Önkoşul — Faz 1.5.5: Tenant Şekli

1.6'ya başlamadan **zorunlu.** Ajans senaryosu kesinleştiği için, 1.6–1.9 boyunca yazılacak her sorgu tenant'a göre filtrelenecek. Bunu `where: { userId }` ile yazıp Faz 2'de org'a geçmek, tüm sorguları baştan yazmak demektir.

İzolasyon sınırı **`User` değil `Organization`.** Projeler kullanıcıya değil organizasyona ait olur; kullanıcı org'a `Membership` ile bağlanır.

- **Bugün (tek kullanıcı):** Kayıtta her kullanıcıya otomatik bir "kişisel organizasyon" açılır, OWNER olur, tüm projeleri o org'a bağlanır. Deneyim bugünküyle birebir aynı.
- **Ajans geldiğinde:** Ajans = içinde çok üyelik olan bir org. Solo = tek üyelik. **Aynı tablo, aynı sorgular, sıfır migration.**

> **Yetkilendirme kuralı (kritik):** Tenant sınırı "bu kullanıcı, bu projenin ait olduğu org'un üyesi mi?" sorusudur ve **sorgu katmanında** olmak zorundadır. Middleware sadece "logged in mi?" sorusunu yanıtlar — IDOR'a (başkasının verisini ID değiştirerek okuma) karşı korumaz. İkisi ayrı katman, biri diğerinin yerini tutmaz.

**Tuzak:** Tenant modeline `Account` adı verme — Auth.js Prisma adapter'ı OAuth için bu adı kullanıyor, ileride çakışır. `Organization` kullan.

---

## Faz 1.6 — Bilgi Tabanı & Kural Anayasası (Grounding Layer)

Sistemin **tek doğruluk kaynağı** ve en kritik temel fazı. **Bir veri-girişi modülü değil; site audit'ini alıp siteye özel içerik kurallarını AI ile türeten bir motor.**

### Ne yapar

`SiteAudit` çıktısını (Faz 1.5) girdi alır ve şunları **türetir**:

- **Doğrulanmış faktlar:** Site verilerinden çıkarılan teknik gerçekler (ör. durability class, ASE, density, fire performance). Tipli/yapılı saklanır.
- **Fakt düzeltmeleri (guardrails):** AI, site içi çelişkileri yakalar. *Kanonik örnek:* sayfada "Class 1" yazıyor ama EN 350 test verisi Class 2'yi destekliyor → sistem `FACT_CORRECTION` üretir: "doğru değer Class 2; tüm içerikte Class 1 yasak." **Bu kural, audit'in taradığı veriyi ezer.**
- **Yasak ifadeler:** Marka diline aykırı kalıplar (ör. "cheap", "Ultimately ile başlayan cümle"). Her biri *nedeni* ve *kanıtı* ile.
- **Yazım talimatları:** Min kelime, dil/yazım (British vs American), ton, zorunlu bölümler.
- **Pillar adayları & trusted outbound link kütüphanesi.**
- **Siteye özel checklist:** Manuel sürecimizdeki 30-maddelik checklist'in otomatik, siteye uyarlanmış hali. **Bu checklist, Faz 1.8 kalite kapısının doğrulama kriteri olur** — hardcoded değil, türetilmiş.

### İnsan döngüsü

AI türetir → durum `DRAFT` → insan her kuralı **review/toggle/override** eder → onaylar → `APPROVED`. Her kural `origin` taşır (`AI_DERIVED` / `USER_ADDED` / `USER_OVERRIDE`), böylece neyin AI'dan neyin insandan geldiği izlenir. Provenance (kanıt + kaynak URL) saklanır; SaaS'ta yeni kullanıcı "AI neden bu kuralı koymuş" diye görebilir.

### Çıktı seam

Bu fazın ürünü, yazım motoruna verilen bir **`Constitution` / FactPack** paketidir: `{ verifiedFacts, activeRules, writingInstructions, outboundLinks }`. Faz 1.8 bu paketi grounded context olarak tüketir.

**Neden ilk?** Temelsiz yazım motoru bir yükümlülüktür. Grounding cila değil, taşıyıcı kolon.

---

## Faz 1.7 — Strateji, İçerik Planı & Internal Link Grafiği

"Ne yazılacak, hangi sırayla, nasıl linklenecek" beyni. Girdi: `SiteAudit` + `KnowledgeBase` + (manuel girilen) rakip verisi.

### Ne yapar

- **Strateji:** Pillarlar, keyword cluster'ları (focus ≤2 kelime + secondary'ler), GEO hedefleri, içerik dağılımı (informational/transactional/local).
- **İçerik Planı:** Bağımlılık mantıklı sıralı takvim (pillar-first → otorite kurulmadan diğerleri sıralanamaz), content type (`how-to`/`listicle`/`guide`/`comparison`/`local`), priority (`quick-win`/`medium`/`long-term`).
- **Internal link grafiği (birinci sınıf):** Hangi post hangisine, hangi anchor text ile. İlişkisel ve **sıra-duyarlı** — var olmayan/planlanmamış posta link verilemez. Anchor kuralı: her zaman focus keyword veya ürün adı; çevre cümleye yayılan anchor yasak.
- **Onay kapıları:** Strateji review/revision → onaylanmadan plan üretilmez; plan onaylanmadan üretim başlamaz.

### Rakip verisi — kilit içgörü

Rakip analizini **manuel süreçte zaten yapıyoruz** (rakip profilleri, keyword havuzları, gap'ler). Bu yüzden strateji modülü rakip verisini **elle girilebilir/import edilebilir** olacak şekilde tasarlanır. ResearchContext seam'i `{ siteAudit, knowledgeBase, competitors? }` — `competitors` bugün manuel, Faz 1.9'da otomatik dolar. Bu, "otomatik rakip analizi önce mi" sorusunu çözer: **veri bugün, otomasyon sonra.**

> **Şema notu (1.7):** `InternalLink` modeli eklenir (sourcePlan, targetPlan, anchorText, status — `ArticlePlan`'a iki yönlü named relation). Strategy/StrategyRevision/ContentPlan/ArticlePlan mevcut şemada zaten var.

---

## Faz 1.8 — Üretim Hattı: Yapılandırılmış Çıktı + Kalite Kapıları + Görsel → WP Draft

Makale fabrikası. En büyük faz. **Döngü burada kapanır:** site giriyorsun, WP'de draft beliriyor. Kişisel kullanım için asıl "iş biten" an.

### Çıktı bir sözleşmedir (serbest metin değil)

Yazım motoru (Faz 1 bölüm-bazlı mekanizma + 1.6 Constitution grounding) şu şablonu doldurur:

1. WordPress Instructions bloğu (category, slug, focus keyword, link notları)
2. SEO meta (title ≤60 char, description ≤135 char)
3. H1 + gövde (bölüm bazlı yazım — her H2 ayrı `ArticleSection`, checkpoint'li)
4. FAQ (≥6 soru: Google PAA + ≥2 B2B specifier)
5. CTA → contact form
6. **GEO Quick Reference bloğu** (AI citation için yapılandırılmış özet — manuel süreçteki format)
7. Schema markup (Article + FAQPage nested JSON-LD)
8. Görsel talimatları (her görsel için: dosya adı + prompt/source + alt + title + description)

### Kalite kapısı = somut validator

1.6'da türetilen checklist'e göre **her kural pass/fail** döner:

- Keyword density ≥ hedef — **gerçek ölçümle.** ⚠️ Manuel süreçteki "bash'te %1.5'e şişir" telafisini **kodlama**; hedef CMS'in (Rank Math) ölçtüğü gibi ölç, yoksa keyword stuffing riski.
- Kelime ≥ hedef (ör. 4000), title/meta karakter limitleri
- Internal link yoğunluğu (max 1/200 kelime, aynı paragrafta iki link yok)
- Yasak-ifade taraması, fakt düzeltme kontrolü (Class 2), dil/yazım (British)

Fail → teslim öncesi otomatik revizyon döngüsü.

### Görsel: ikili pluggable sağlayıcı

`ImageProvider` arayüzü, iki implementasyon: `AIImageProvider` (prompt → üretim) ve `StockImageProvider` (sorgu → Unsplash/stok arama → seç). Proje/görsel bazında seçilir. Dosya isimlendirme kuralı (`marka-[keyword]-[desc].jpg`) ikisinde de aynı sözleşmeye uyar.

### Yayın: Publisher seam

`Publisher.publish(article, connection)` — bugün tek implementasyon WordPress (REST API, draft). İleride Webflow/Ghost (`CMSConnection.type` hazır) aynı arayüzü implement eder.

### Onay kapıları

Outline onayı → SEO-meta onayı → preview onayı (sen onaylamadan WP'ye gitmez).

> **Şema notu (1.8):** Yapılandırılmış FAQ (`FAQItem` tablosu ya da `Article.faq` Json), `Article.schemaMarkup` (Json), mod/provider'lı zengin görsel modeli, kalite-kapısı sonuç saklama. `Article` state machine ve `ArticleSection` mevcut.

---

## Faz 1.9 — Rakip Otomasyonu + Gap-Analizi Döngüsü + Editöryel İterasyon

Sistemi **akıllı ve iteratif** yapar. "Yazdıkça büyüyor" dediğin şeyin tam karşılığı. En yoğun faz; istenirse editöryel kısım ile rakip-otomasyon kısmı bağımsız ship edilebilir.

- **Rakip otomasyonu:** SERP keşfi + Keyword Planner export import + rakip matrisi + analiz. (1.7'deki manuel giriş çalışmaya devam eder; bu onu otomatikleştirir → asıl bir **SaaS özelliği**, çünkü yeni kullanıcı bu araştırmayı yapmamıştır.)
- **Gap-analizi motoru:** Yayınlanan/planlanan içerik vs rakip keyword'leri → (a) mevcut postlara secondary keyword ekleme önerileri (b) yeni post fırsatları → **plana geri besler.** Manuel sürecimizdeki gap analizinin otomasyonu.
- **Editöryel iterasyon:** Bölüm yeniden yazımı (feedback ile), versiyonlama (`ArticleVersion`), hot-edit lockout (Shield #9 — yazım sırasında UI read-only), edit sonrası kalite kapısını tekrar çalıştırma, WP draft'ı re-sync.
- **Internal-link bakımı:** Yeni post eklenince grafiği güncelle + eski postları geri-düzenleyip yeni posta link ekle (manuel süreçteki "yayınlandığında link ekle" kuralı).

> **Şema notu (1.9):** Gap-analizi sonuç saklama, plan-evrim takibi. `ArticleVersion`/`currentVersion` mevcut.

---

## Faz 2 — SaaS Omurgası

Artık tam çalışan **tek-tenant** ürünü çok-kiracılıya açar. Şekil 1.5.5'te oturduğu için bu faz büyük ölçüde "kod ekleme", "tablo değiştirme" değil.

- **Auth:** NextAuth/Auth.js v5 + **Credentials provider + JWT.** Not: Credentials, Auth.js v5'te database session'ı desteklemez — JWT zaten zorunlu yol. Bedeli: JWT sunucu tarafında iptal edilemez (token süresi dolana dek geçerli). Telafi: kısa token ömrü + sensitive işlemlerde plan/status'ü her seferinde DB'den kontrol (zaten billing için yapılacak).
- **Şifreleme:** Şifreler `bcrypt`/`argon2` ile hash. `CMSConnection.credentials` field-level şifreli (`prisma-field-encryption` mevcut, aktif et) — asla plaintext.
- **Middleware + satır-bazlı yetki enforcement'ı:** Coarse auth middleware'de, asıl tenant izolasyonu sorgu katmanında.
- **Rol enforcement & davet akışı:** OWNER/ADMIN/MEMBER kuralları devreye, e-posta ile üye davet/kabul.
- **Billing-ready kancalar:** Plan/kota alanları, Stripe entegrasyonu için yüzey.
- **Per-tenant onboarding:** 1.6 Kural Anayasası türetme, yeni müşteri için onboarding adımı olur.

---

## 🚫 Kapsam Dışı (Net Olalım)

Manuel stratejideki şu GEO kalemleri **blog otomasyonu değil**, ayrı bir pazarlama yüzeyidir ve (en azından Faz 2 sonrasına kadar) manuel kalır: TDS PDF, EPD süreci, ArchDaily profili, BIM dosyaları, case study'ler. **Comparison sayfaları** (`/compare/x-vs-y`) ise sıradan bir content type'tır — plan içeriyorsa normal hat üretir.

---

## 🔌 Mimari Seam'ler (Soyutlamalar)

Modülerliğin kalbi. Her biri tek bir arayüz, çoklu implementasyon:

| Seam | Arayüz | Bugün | İleride |
| :--- | :--- | :--- | :--- |
| **ResearchContext** | `{ siteAudit, knowledgeBase, competitors? }` | competitors manuel | 1.9 otomatik doldurur |
| **Constitution / FactPack** | `{ verifiedFacts, activeRules, writingInstructions, outboundLinks }` | 1.6 üretir, 1.8 tüketir | per-tenant |
| **ImageProvider** | `provide(spec) -> image` | AI + Stok | yeni sağlayıcılar |
| **Publisher** | `publish(article, connection)` | WordPress draft | Webflow / Ghost |

---

## 🗄️ Şema: Şimdi Eklenecekler (Faz 1.5.5 + 1.6)

> Aşağıdaki bloklar **eklenecek/değişecek** kısımlardır. Değişmeyen base modeller (`Article`, `ArticleSection`, `ContentPlan`, `ArticlePlan`, `Strategy`, `Competitor`, `SiteAudit`, `ContentSource`) mevcut `prisma/schema.prisma` içinde olduğu gibi kalır. 1.7/1.8/1.9 eklemeleri ilgili faz bölümlerindeki "Şema notu"nda; o fazlara gelince netleştirilecek (erkenden over-engineer etmiyoruz).

### Tenant (Faz 1.5.5)

```prisma
model Organization {
  id             String          @id @default(cuid())
  name           String
  members        Membership[]
  projects       Project[]
  cmsConnections CMSConnection[]
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
}

model Membership {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  role           MemberRole   @default(OWNER)
  createdAt      DateTime     @default(now())

  @@unique([userId, organizationId]) // bir kullanıcı bir org'a tek üyelik
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
}
```

### Bilgi Tabanı & Kural Anayasası (Faz 1.6)

```prisma
model KnowledgeBase {
  id        String   @id @default(cuid())
  projectId String   @unique
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // Faz 1.6: SiteAudit'ten AI ile türetilir, insan onaylar
  verifiedFacts       Json   // {durabilityClass, density, ASE, fire, ...}
  brandEntities       Json   // {distributors, certifications, testInstitutions, standards}
  writingInstructions Json   // {minWords, language, spelling, tone, requiredSections}
  generatedChecklist  Json   // siteye özel checklist — 1.8 kalite kapısı bunu kullanır

  status        KBStatus        @default(DRAFT)
  rules         ContentRule[]
  pillars       ContentPillar[]
  outboundLinks OutboundLink[]

  approvedAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}

enum KBStatus {
  DRAFT     // AI türetti, insan onayı bekliyor
  APPROVED
  REVISION
}

model ContentRule {
  id              String        @id @default(cuid())
  knowledgeBaseId String
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)

  type     RuleType
  value    String       // "Class 1" (yasak), "min 4000 words" (zorunlu)
  reason   String?      // NEDEN var — provenance
  evidence Json?        // {sourceUrl, conflictingValue, verifiedValue}
  isActive Boolean      @default(true) // insan toggle edebilir
  origin   RuleOrigin   @default(AI_DERIVED)

  createdAt DateTime @default(now())
}

enum RuleType {
  FORBIDDEN_PHRASE  // "Class 1", "cheap", "Ultimately"
  FACT_CORRECTION   // doğru değer X'tir (audit'i ezer)
  REQUIRED          // min kelime, FAQ zorunlu
  STYLE             // British spelling, ton
}

enum RuleOrigin {
  AI_DERIVED    // site analizinden türetildi
  USER_ADDED    // insan ekledi
  USER_OVERRIDE // insan AI kuralını değiştirdi
}

model ContentPillar {
  id              String        @id @default(cuid())
  knowledgeBaseId String
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  name      String
  scope     String
  colorCode String?
  createdAt DateTime @default(now())
}

model OutboundLink {
  id              String        @id @default(cuid())
  knowledgeBaseId String
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  url       String
  title     String
  usageArea String?  // "Sustainability, certification bölümleri"
  createdAt DateTime @default(now())
}
```

### Mevcut modellerde değişen satırlar

```prisma
model User {
  // SİL: projects Project[]  ve  cmsConnections CMSConnection[]
  // EKLE:
  memberships Membership[]
  // ... diğer alanlar aynı
}

model Project {
  // DEĞİŞTİR: userId/user  ->  organizationId/organization
  organizationId String
  organization   Organization   @relation(fields: [organizationId], references: [id])
  // EKLE:
  knowledgeBase  KnowledgeBase?
  // ... diğer alanlar (siteAudit, sources, competitors, strategy, contentPlan, articles, state) aynı
}

model CMSConnection {
  // DEĞİŞTİR: userId/user  ->  organizationId/organization  (org-level karar)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  credentials    String       /// @encrypted  (Faz 2'de aktif)
  // ... diğer alanlar aynı
}
```

> **Karar (CMS bağlantısı):** Org-level seçildi — ajans bir müşterinin WP'sini bir kez bağlar, tüm ekip kullanır. CMS bağlantısı bir müşteri-varlığı, kişisel değil.

---

## 🔒 16-Shield Blueprint (Özet)

1. **Serverless Timeout Shield (1):** Next.js LLM beklemez; `HTTP 202` döner, iş asenkron Celery'de.
2. **State Checkpointing Shield (1):** Her H2 `ArticleSection`'a yazılır; çökmede kaldığı yerden devam.
3. **DB Connection Choking Shield (1):** Mikro loglar DB yerine Redis'te.
4. **Rolling Context Window (1):** Static kurallar + Section i-1 → bağlam kayması engellenir.
5. **Redlock Distributed Lock (2):** Çoklu worker aynı bölümü mükerrer yazmaz.
6. **Webhook HMAC Signatures (1.9/2):** Worker POST'ları gövde-bazlı imzalı; rogue POST biter.
7. **Strict Context Isolation (1):** Statik kurallar prompt'un tepesinde ham korunur.
8. **Schema Drift Guard (1.9):** TS tipleri JSON şemaya derlenir, worker açılışta doğrular.
9. **Hot-Edit Lockout (1.9):** Yazım sırasında UI read-only kilitlenir.
10. **CF R2 Side-Loading (3):** Görseller önce R2'ye WebP, WP'ye CDN linki.
11. **Crawl Depth & Page Caps (1.5):** Bütçe için max sayfa limiti otonom.
12. **Dual-Key Secret Rotation (2):** Webhook şifre değişiminde eski worker'lar 24s çökmez.
13. **Smart Proxy Rotator (1.9):** Crawling'de IP blokajına karşı residential proxy rotasyonu.
14. **JSON Auto-Repair (1.8):** Kırık LLM JSON'ı `json-repair` ile onarılır.
15. **WP SEO Meta Verification (1.8):** Yoast/RankMath meta kaymasını post-publish düzeltir.
16. **Zombie Process Recycler (1):** `worker_max_tasks_per_child = 50` ile memory sızıntısı temizlenir.

---

## 🔑 Çevre Değişkenleri Şablonu

> `.env` ve `.env.local` **asla commit edilmez.** `.gitignore`'a: `.env`, `.env.local`, `.env*.local`. Takım için `.env.example` (gerçek değer olmadan) repoya eklenir.

### Next.js (`.env.local`)

```
# Database (Faz 1 SQLite -> Faz 3 PostgreSQL)
DATABASE_URL="file:./dev.db"

# Redis
REDIS_URL="redis://localhost:6379/0"

# Auth (Faz 2)
AUTH_SECRET="en-az-32-karakterli-rastgele-kod"
AUTH_URL="http://localhost:3000"

# Internal Security (Faz 1 Bearer -> Faz 1.9/2 HMAC)
INTERNAL_SECRET_TOKEN="mvp-icin-guclu-statik-parola"

# External APIs
DATAFORSEO_API_KEY="..."
UNSPLASH_ACCESS_KEY="..."
```

### Python Worker (`.env`)

```
REDIS_URL="redis://localhost:6379/0"
NEXTJS_INTERNAL_URL="http://localhost:3000/api/internal/jobs"
INTERNAL_SECRET_TOKEN="mvp-icin-guclu-statik-parola"
GEMINI_API_KEY="..."
```

---

## 🚦 Kurulum & İlk Adımlar (Ufaktan Başlamak)

Faz sırasına göre kodlama önerisi:

1. **1.5.5 Tenant:** Yukarıdaki `Organization`/`Membership`/`MemberRole`'ü şemaya ekle → `npx prisma db push` → `npx prisma studio` ile kontrol. Kayıtta `user + org + membership`'i **tek transaction'da** açan servis fonksiyonunu yaz.
2. **1.6 Bilgi Tabanı:** `KnowledgeBase` + `ContentRule` + `ContentPillar` + `OutboundLink` ekle. SiteAudit çıktısını alıp Constitution türeten Celery görevini (`derive_constitution`) yaz. İnsan-onayı UI'ı (kural listesi + toggle/override).
3. **1.7 → 1.9:** İlgili faz bölümlerindeki seam'lere ve şema notlarına göre ilerle.

**Worker çalıştırma:**
```
celery -A main worker --loglevel=info -c 1
```
**Dev server:**
```
npm run dev
```

---

> **DOKÜMAN BİTİŞ NOTU:** Bu dosya BlogForge'un resmi v2 dokümantasyonudur. Fazlandırma, grounding-first ilkesi ve seam'ler tüm geliştirmelerin bağlayıcı çerçevesidir. Yeni bir yetenek eklenmeden önce: "Hangi faza ait? Hangi seam'i tüketiyor/besliyor? Tenant-safe mi?" sorularına yanıt verilmelidir.

*Son güncelleme: 29 Mayıs 2026 — v2 (Faz 1.6 → 1.9 detaylandırması)*
