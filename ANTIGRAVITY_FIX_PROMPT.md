# BlogForge — Düzeltme & Sağlamlaştırma Görev Promptu (Antigravity)

Sen kıdemli bir full-stack mühendisisin ve bu repoda (BlogForge) aşağıdaki işleri **sırayla** yapacaksın. Her şey burada tarif edildi; yorum katmana veya kapsam genişletmene gerek yok — **sadece uygula**. Belirsizlik olursa mevcut kodu grep'leyip en az riskli, tarif edilen davranışı uygula.

---

## 🔧 PROJE BAĞLAMI (önce oku)

- **Stack:** Next.js 16 (App Router, TypeScript) + Prisma + **SQLite** (`provider = "sqlite"`, migration YOK, `prisma db push` kullanılıyor) + Python Celery worker. Worker, Next.js'ten Redis'e elle Celery mesajı pushlanarak tetikleniyor (`src/lib/celery.ts`). LLM = Google Gemini.
- **Akış:** `analyze-sources` → `derive_constitution` (KB üretimi) → insan onayı → `generate_strategy` (strateji + internal link) → insan onayı → section-by-section yazım (`generate_section_iterative`) → `produce_article_factory` (SEO/FAQ/schema + quality gate) → WordPress draft. Rakip/gap/editöryel = Faz 1.9 görevleri.
- Worker DB'ye doğrudan erişmez; her şeyi `POST /api/internal/jobs` webhook'una `action` ile bildirir (Bearer token ile).

### MUTLAK KURALLAR (her fazda geçerli)
1. **SQLite'ta kal.** Postgres'e geçme. Şema değişince `npx prisma generate && npx prisma db push` çalıştır.
2. **`.env`, `worker/.env` dosyalarının içeriğini OKUMA ve DEĞİŞTİRME.** Sadece env değişken *adlarına* referans ver.
3. **Çalışan mock akışını bozma:** `WP_MOCK_MODE`, `COMPETITOR_MOCK_MODE` davranışları korunmalı.
4. **Next.js 16 notları:** route handler'larda `params`/`cookies()`/`headers()` async'tir (await et). Middleware dosyası bu projede `proxy.ts`'tir (`middleware.ts` değil) — ama bu prompt'ta yeni middleware EKLEMİYORUZ.
5. Her fazdan sonra: `npx tsc --noEmit` (veya `npm run build`) hatasız geçmeli; worker dosyaları import edilebilir olmalı (`python -c "import tasks"` worker/ içinde). Yeni paket eklersen **sürümünü pinle**.
6. **Her fazı ayrı commit et** (`git add -A && git commit -m "..."`) ve **fazı bitince DUR, kısa bir özet yaz, bir sonraki faza geçmeden bekle.** Kullanıcı checkpoint yapacak.
7. Bir alanı/satırı silmeden önce **referanslarını grep'le** (`grep -rn "alanAdı" src worker`); kullanılan bir şeyi körlemesine silme.

---

## FAZ 1 — Grounding'i uçtan uca bağla (EN ÖNEMLİ)

**Sorun:** KB (kurallar, dil, yasak ifadeler) üretiliyor ve saklanıyor ama (a) yazar prompt'u dili **"Türkçe" olarak hardcode** ediyor, (b) quality gate bir stub (sadece `word_count < 300`), (c) yazara aktarılan `static_rules` onaylı KB'den assemble edilmiyor.

### 1A. KB → Constitution assembler oluştur
Yeni dosya: **`src/lib/knowledge-base.ts`**
```ts
import { prisma } from './db/prisma';

export interface Constitution {
  language: string;
  minWords: number;
  rulesText: string;            // generate_section_iterative'e static_rules olarak geçilecek
  rulesForGate: { type: string; value: string; reason?: string | null }[];
  verifiedFacts: unknown;
}

/** Onaylı (APPROVED) KnowledgeBase'i derler. APPROVED değilse null döner. */
export async function buildConstitution(projectId: string): Promise<Constitution | null> {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { projectId },
    include: { rules: { where: { isActive: true } }, outboundLinks: true, pillars: true },
  });
  if (!kb || kb.status !== 'APPROVED') return null;

  const wi = (kb.writingInstructions as any) || {};
  const language = wi.language || 'en';
  const minWords = Number(wi.minWords) || 1500;

  const pick = (t: string) => kb.rules.filter(r => r.type === t).map(r => r.value);
  const corrections = kb.rules
    .filter(r => r.type === 'FACT_CORRECTION')
    .map(r => `${r.value}${r.reason ? ' — ' + r.reason : ''}`);

  const lines: string[] = [];
  lines.push(`DİL: Tüm metni KESİNLİKLE şu dilde yaz: ${language}`);
  lines.push(`MINIMUM KELİME SAYISI: ${minWords}`);
  if (wi.tone) lines.push(`TON: ${wi.tone}`);
  if (corrections.length) lines.push(`DOĞRULANMIŞ GERÇEKLER / ZORUNLU DÜZELTMELER:\n- ${corrections.join('\n- ')}`);
  if (pick('FORBIDDEN_PHRASE').length) lines.push(`YASAK İFADELER (asla kullanma):\n- ${pick('FORBIDDEN_PHRASE').join('\n- ')}`);
  if (pick('REQUIRED').length) lines.push(`ZORUNLULUKLAR:\n- ${pick('REQUIRED').join('\n- ')}`);
  if (pick('STYLE').length) lines.push(`ÜSLUP:\n- ${pick('STYLE').join('\n- ')}`);
  if (kb.verifiedFacts) lines.push(`TEKNİK VERİLER (JSON):\n${JSON.stringify(kb.verifiedFacts)}`);
  if (kb.outboundLinks.length)
    lines.push(`GÜVENİLİR DIŞ LİNKLER:\n${kb.outboundLinks.map(l => `- ${l.url} (${l.title})${l.usageArea ? ' — ' + l.usageArea : ''}`).join('\n')}`);

  return {
    language,
    minWords,
    rulesText: lines.join('\n\n'),
    rulesForGate: kb.rules.map(r => ({ type: r.type, value: r.value, reason: r.reason })),
    verifiedFacts: kb.verifiedFacts,
  };
}
```

### 1B. Yazara dil + assemble edilmiş kuralları geçir
- **`worker/tasks.py` → `generate_section_iterative`**: imza ve prompt'u güncelle.
  - İmzaya `heading_level=2` ve `language="en"` parametresine EK olarak `tone=""` parametresini de ekle (sıralamayı bozma; `previous_content`/`static_rules`'tan sonra konumlandır, çağıran taraf kwargs/positional ile uyumlu olsun — çağrı yerini de güncelleyeceksin).
  - Prompt'taki **`"metni Türkçe olarak ... yaz"`** ifadesini **`f"metni {language} dilinde ... yaz"`** yap. Ayrıca tonu da kullan (örn: "TON: {tone}").
  - Payload'a `"headingLevel": heading_level` ekle.
- `buildConstitution` (knowledge-base.ts) artık `tone` değerini de döndürsün: Constitution interface'ine `tone: string` ekle ve `const tone = wi.tone || ''` ile doldur.
- **`src/app/api/test-panel/route.ts`** (section dispatch — `sendCeleryTask('tasks.generate_section_iterative', [...])` çağrılarının olduğu ~172 ve ~238. satırlar) ve **`src/app/api/test-panel/articles/rewrite-section/route.ts`** (~46): 
  - Dispatch'ten önce `const constitution = await buildConstitution(projectId)` çağır. `constitution` null ise (KB onaylı değil) **422 dön ve dispatch etme** (mesaj: "KnowledgeBase onaylı değil; önce KB'yi APPROVED yapın").
  - `static_rules` argümanına `constitution.rulesText`, ayrıca yeni argüman olarak `constitution.language`, `constitution.tone` ve `nextSection.level` (heading_level) geçir. Celery'ye `language` VE `tone`'u AÇIK POZİSYONEL ARGÜMAN olarak geç; Python tarafı JSON parse etmesin.
  - **KRİTİK UYARI:** Python imzasına yeni pozisyonel argüman eklerken argüman SIRASI kritiktir. `static_rules`'tan sonra `language`, `tone` sırasını koru ve `sendCeleryTask('tasks.generate_section_iterative', [...])` dizisini imzayla BİREBİR aynı sırada güncelle; yoksa `tone` ile `user_feedback` yer değiştirir.

### 1C. Quality gate'i gerçek yap
- **`src/app/api/internal/jobs/route.ts`** içinde `produce_article_factory` dispatch'i (~105-106): kbStr'yi kurallarla birlikte oluştur ve makalenin focus keyword'ünü de geçir:
```ts
const proj = await prisma.project.findUnique({
  where: { id: projectId || existingArticle?.projectId },
  include: { knowledgeBase: { include: { rules: { where: { isActive: true } } } } },
});
const kbStr = JSON.stringify({
  writingInstructions: proj?.knowledgeBase?.writingInstructions ?? {},
  verifiedFacts: proj?.knowledgeBase?.verifiedFacts ?? {},
  rules: proj?.knowledgeBase?.rules?.map(r => ({ type: r.type, value: r.value, reason: r.reason })) ?? [],
});
const focusKeyword = existingArticle?.focusKeyword ?? '';
const { sendCeleryTask } = await import('@/lib/celery');
await sendCeleryTask('tasks.produce_article_factory', [articleId, mergedHtml, kbStr, proj?.id || projectId, focusKeyword]);
```
- **`worker/tasks.py` → `produce_article_factory`**: imzaya `focus_keyword: str = ""` ekle. Quality gate bloğunu şununla değiştir (stub'ı kaldır):
```python
import json, re
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
```
- Components (Gemini) üretildikten **sonra**, webhook'a göndermeden önce meta uzunluklarını da kapıya ekle:
```python
seo = json.loads(response.text).get("seo_wp", {}) if isinstance(response.text, str) else {}
mt = (seo.get("meta_title") or "")
md = (seo.get("meta_description") or "")
if len(mt) > 60:
    quality_gate_result["failures"].append(f"meta_title cok uzun: {len(mt)}>60")
if len(md) > 135:
    quality_gate_result["failures"].append(f"meta_description cok uzun: {len(md)}>135")
quality_gate_result["passed"] = len(quality_gate_result["failures"]) == 0
```
> NOT: `# TODO: fetch actual forbidden phrases` ve `keywordDensity: 0.0  # calculate dynamically later` yorum/stub'larını tamamen kaldır.

**Doğrulama (Faz 1):** `tsc --noEmit` geçer; KB APPROVED değilken section dispatch 422 döner; APPROVED iken yazılan section KB dilinde gelir; mock bir makalede yasak ifade varsa `qualityGate.passed=false` olur.

---

## FAZ 2 — Outline şekli + başlık hiyerarşisi (B1, M1)

**Sorun:** Strateji görevi outline'ı `List[str]` üretiyor; ama orchestrator/status `{ title, level }[]` bekliyor → gerçek stratejiden üretim patlar. Ayrıca webhook tüm başlıkları `<h2>` yazıyor (`headingLevel: 2` sabit).

### 2A. Python strateji şemasını nesne outline'a çevir
- **`worker/tasks.py`**: `ArticlePlanItem.outline` alanını düz string listesinden nesne listesine çevir:
```python
class OutlineItem(BaseModel):
    title: str = Field(description="Bolum basligi")
    level: int = Field(description="Baslik seviyesi: 2 (H2) veya 3 (H3)")

class ArticlePlanItem(BaseModel):
    slug: str
    title: str
    contentType: str
    focusKeyword: str
    secondaryKeywords: List[str]
    outline: List[OutlineItem]   # <-- degisti
    order: int
```
- `generate_strategy` prompt'una ekle: "Her makalenin `outline`'ı `{title, level}` nesnelerinden oluşmalı; ana bölümler level=2, alt bölümler level=3."

### 2B. heading_level'i uçtan uca taşı
- **`src/app/api/test-panel/route.ts`** ve **`rewrite-section/route.ts`**: `nextSection.level` (yoksa `2`) değerini `generate_section_iterative` argümanlarına `heading_level` olarak geçir (Faz 1B ile birlikte).
- **`worker/tasks.py`**: zaten 1B'de `heading_level`'i payload'a ekledin.

### 2C. Webhook'ta gerçek heading level kullan
- **`src/app/api/internal/jobs/route.ts` → `section_complete`**:
  - `body`'den `headingLevel` al; `ArticleSection.upsert`'in **create** dalında `headingLevel: 2` yerine `headingLevel: headingLevel || 2` yap.
  - mergedHtml satırını şununla değiştir:
    ```ts
    const mergedHtml = sections
      .map(s => `<h${s.headingLevel}>${s.headingTitle}</h${s.headingLevel}>\n${s.htmlContent}`)
      .join('\n\n');
    ```

**Doğrulama:** Strateji çıktısındaki H3 başlıklar üretimde `<h3>` olarak render olur; section dispatch gerçek stratejiyle (mock olmadan) `heading_title=undefined` vermez.

---

## FAZ 3 — Pipeline güvenilirliği (C4, C6, M5, B2, m2)

**Sorun:** FAILED state yok (patlayan görev sonsuza dek WRITING'de kalır); worker HTTP çağrılarında timeout yok; retry/backoff yok; `generate_strategy`'de `return`'den sonra ölü `raise` + `else` yok (sessiz hata); webhook hata mesajı sızıyor.

### 3A. Şemaya FAILED + hata alanı ekle
**`prisma/schema.prisma`**:
- `enum ProjectState`'e `FAILED` ekle. `enum ArticleState`'e `FAILED` ekle.
- `model Project`'e `lastError String?` ekle. `model Article`'a `lastError String?` ekle.
- `npx prisma db push`.

### 3B. Worker: timeout + retry + merkezî webhook POST helper + failure bildirimi
**`worker/tasks.py`** en üste bir helper ekle ve **tüm** `requests.post(nextjs_api_url, ...)` çağrılarını bununla değiştir:
```python
import requests, os

def _post_to_nextjs(payload: dict):
    url = os.getenv("NEXTJS_INTERNAL_URL", "http://localhost:3000/api/internal/jobs")
    token = os.getenv("INTERNAL_SECRET_TOKEN")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    res = requests.post(url, json=payload, headers=headers, timeout=(10, 60))  # connect, read
    if res.status_code != 200:
        raise Exception(f"Next.js internal API error ({res.status_code}): {res.text}")
    return res
```
Görev dekoratörlerini retry'lı yap (örnek):
```python
@app.task(
    bind=True, name="tasks.generate_section_iterative",
    autoretry_for=(Exception,), max_retries=3, retry_backoff=True,
    retry_backoff_max=60, retry_jitter=True, acks_late=True,
)
def generate_section_iterative(self, article_id, project_id, section_order, heading_title,
                               heading_level=2, previous_content="", static_rules="",
                               language="en", user_feedback=None):
    try:
        ... mevcut govde, _post_to_nextjs(payload) kullanarak ...
        return {"status": "success", "order": section_order}
    except Exception as e:
        if self.request.retries >= self.max_retries:
            _report_failure(article_id=article_id, project_id=project_id, error=str(e))
        raise
```
Aynı `bind=True` + try/except + retry desenini **tüm** görevlere uygula (`derive_constitution`, `generate_strategy`, `produce_article_factory`, `publish_to_wordpress`, `analyze_competitors`, `run_gap_analysis`, `retro_link_maintenance`). `_report_failure` helper'ı:
```python
def _report_failure(article_id=None, project_id=None, error=""):
    try:
        _post_to_nextjs({"action": "job_failed", "articleId": article_id,
                         "projectId": project_id, "error": error[:500]})
    except Exception:
        pass  # failure bildiriminin kendisi patlarsa yut
```

### 3C. B2 — `generate_strategy` ölü kod / sessiz hata
`generate_strategy` sonundaki `if res.status_code == 200: ... return ...` bloğundaki `return`'den sonraki erişilemez `raise`'i kaldır. Artık `_post_to_nextjs` non-200'de zaten exception fırlatıyor, yani success path basit: çağrıyı `_post_to_nextjs(payload)` yap, ardından `return {"status": "success", "projectId": project_id}`.

### 3D. Webhook: `job_failed` action + güvenli hata cevabı
**`src/app/api/internal/jobs/route.ts`**:
- Yeni action ekle:
```ts
if (action === 'job_failed') {
  const { articleId, projectId, error } = body;
  if (articleId) await prisma.article.update({ where: { id: articleId }, data: { state: 'FAILED', lastError: String(error ?? '').slice(0, 500) } }).catch(() => {});
  if (projectId) await prisma.project.update({ where: { id: projectId }, data: { state: 'FAILED', lastError: String(error ?? '').slice(0, 500) } }).catch(() => {});
  return NextResponse.json({ success: true });
}
```
- En dıştaki `catch (error: any)` bloğunu güncelle: `console.error('[internal/jobs] error:', error);` ile server'a logla, cevabı **generic** yap:
```ts
return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
```

### 3E. Celery config sertleştirme
**`worker/config.py` → `CeleryConfig`** içine ekle:
```python
task_acks_late = True
task_reject_on_worker_lost = True
broker_connection_retry_on_startup = True
broker_transport_options = {"visibility_timeout": 3600}
```

**Doğrulama:** Worker'ı `NEXTJS_INTERNAL_URL`'i bilinçli yanlış verip çalıştır → görev retry sonrası `job_failed` ile makaleyi `FAILED` + `lastError`'a çeker, sonsuz takılmaz. Webhook 500'leri artık iç mesaj sızdırmaz.

---

## FAZ 4 — Gemini sağlamlığı + kaynak analizini worker'a taşı (S4, C6-TS, B5)

### 4A. `gemini.ts`: timeout + retry + key'i header'a al
**`src/lib/gemini.ts`** → `generateContent`'i güncelle:
- URL'den `?key=${apiKey}` kısmını **kaldır**; bunun yerine fetch headers'a `'x-goog-api-key': apiKey` ekle.
- `AbortController` ile timeout (60sn) ve 429/5xx'te 3 denemeli exponential backoff ekle:
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);
let lastErr: unknown;
try {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: controller.signal });
    if (response.ok) { /* parse & return */ }
    if (response.status === 429 || response.status >= 500) { await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); lastErr = new Error(`Gemini ${response.status}`); continue; }
    const t = await response.text(); throw new Error(`Gemini API error: ${response.status} - ${t}`);
  }
  throw lastErr ?? new Error('Gemini: retries exhausted');
} finally { clearTimeout(timeout); }
```

### 4B. Kaynak analizini (LLM) Celery'ye taşı
**Sorun:** `analyze-sources/route.ts`, `source-analyzers.ts`'teki 6 senkron `generateContent` çağrısını request içinde await ediyor → serverless timeout riski (Shield #1 ihlali).
- Yeni Celery görevi: **`worker/tasks.py` → `tasks.analyze_sources`**. `source-analyzers.ts`'teki LLM prompt mantığını Python'a port et (scraping TS'te kalabilir; sadece **LLM analiz** kısmı worker'a taşınır). Görev, her kaynağın çıkarılmış ham metnini alıp analiz eder, sonuçları `action: "sources_analyzed"` ile webhook'a yollar ve ardından `derive_constitution`'ı **chain** eder (ya da webhook `sources_analyzed` handler'ı derive'ı tetikler).
- **`analyze-sources/route.ts`**: scraping'i yap, ham veriyi `ContentSource.extractedData`'ya kaydet, sonra `sendCeleryTask('tasks.analyze_sources', [...])` ile dispatch et ve **hemen 202 dön**. Route içindeki senkron `generateContent` çağrılarını kaldır.
- Webhook'a `sources_analyzed` action handler ekle: gelen analiz sonuçlarını ilgili `ContentSource`'lara yazar, `status: "ANALYZED"` yapar.

> Eğer port kapsamı büyürse: en azından scraping + kaydetme + `derive_constitution` dispatch'ini route'ta bırak, ama **request içinde hiçbir LLM çağrısı kalmasın**; tüm Gemini işi worker'da olsun.

**Doğrulama:** `analyze-sources` isteği saniyeler içinde 202 döner; Gemini işleri worker loglarında görünür.

---

## FAZ 5 — Güvenlik: credential sızıntısı + TLS (S1, S2, S3)

### 5A. WordPress credential'ını kuyruğa koyma; yayını TS'e taşı
**Sorun:** `production_complete` ve `publish-wp`, çözülmüş `credentials`'ı Celery payload'una koyuyor → Redis'e plaintext yazılıyor; ayrıca `publish_to_wordpress` mock modda credential'ı loglsuyor.
- Yeni dosya **`src/lib/wordpress.ts`**:
```ts
export async function publishToWordPress(opts: {
  siteUrl: string; credentials: string;  // "user:app_password"
  payload: { title: string; content: string; status: string; slug?: string };
}): Promise<{ mocked: boolean; id?: number; url?: string }> {
  if ((process.env.WP_MOCK_MODE ?? 'true').toLowerCase() === 'true') {
    console.log('[WP_MOCK] ->', opts.siteUrl, opts.payload.title); // credential LOGLAMA
    return { mocked: true };
  }
  const auth = Buffer.from(opts.credentials).toString('base64');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${opts.siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.payload),
    });
    if (![200, 201].includes(res.status)) throw new Error(`WP API ${res.status}: ${await res.text()}`);
    const j = await res.json(); return { mocked: false, id: j.id, url: j.link };
  } finally { clearTimeout(t); }
}
```
- **`src/app/api/internal/jobs/route.ts` → `production_complete`** ve **`src/app/api/test-panel/publish-wp/route.ts`**: `sendCeleryTask('tasks.publish_to_wordpress', ...)` çağrılarını kaldır; bunun yerine ilgili `CMSConnection`'ı oku ve `publishToWordPress({ siteUrl, credentials, payload })` çağır. Dönen `id/url`'i `Article.cmsPostId/cmsPostUrl`'e yaz, başarılıysa `state: 'PUBLISHED'`, `publishedAt: new Date()`.
- **`worker/tasks.py`**: `publish_to_wordpress` görevini **kaldır** (artık kullanılmıyor) VEYA gövdesini boşaltıp `raise NotImplementedError("Publishing moved to Next.js")` yap. Credential `print` satırını her hâlükârda sil.

### 5B. TLS cert doğrulamasını env-gate'le
- **`src/lib/redis.ts`**: `rejectUnauthorized: false` yerine: `tls: url.startsWith('rediss://') ? { rejectUnauthorized: process.env.ALLOW_INSECURE_TLS !== 'true' } : undefined`. (Yani **varsayılan güvenli**; sadece `ALLOW_INSECURE_TLS=true` iken gevşer.)
- **`worker/config.py`**: `ssl_cert_reqs` değerini env'e bağla:
```python
import ssl
_insecure = os.getenv("ALLOW_INSECURE_TLS", "false").lower() == "true"
_cert_reqs = ssl.CERT_NONE if _insecure else ssl.CERT_REQUIRED
# rediss:// bloğunda ssl_cert_reqs = _cert_reqs kullan
```

**Doğrulama:** Mock modda WP yayını credential loglamıyor; Celery payload'unda credential geçmiyor; `ALLOW_INSECURE_TLS` set değilken TLS doğrulaması açık.

---

## FAZ 6 — Veri bütünlüğü & bug'lar (B3, B4, B6, M3, M6, slug)

### 6A. B3 — `produce_article_factory` tam metin
`worker/tasks.py` prompt'unda `{html_content[:5000]}... (kesilmiş olabilir)` ifadesini `{html_content}` ile değiştir (kesme yok).

### 6B. B4 — Retro-link'i section düzeyinde uygula
**Sorun:** `retro_link_maintenance` sadece `Article.htmlContent` blob'una yazıyor; `section_complete` her yazımda blob'u section'lardan yeniden kurduğu için link eziliyor.
Otorite SECTION'dır; `Article.htmlContent` her zaman section'lardan TÜRETİLİR (Shield #2 ile tutarlı). Bu yüzden `retro_link_maintenance` linki ASLA `Article.htmlContent` blob'una yazmasın. Bunun yerine: görev `action: 'retro_link_request'` (articleId, focusKeyword, newArticleSlug) ile webhook'a istek atsın; link enjeksiyonu Next.js tarafında TS'te (`cheerio` ile — repoda zaten var) yapılsın. Mantık: o keyword'ü içeren İLK uygun `ArticleSection.htmlContent`'i bul (sadece p/li/span/div/td içinde, `<a>` ve başlık etiketlerinin içini ATLA), o section'a tek bir `<a href="/blog/{slug}">...</a>` enjekte et, SADECE o ArticleSection satırını update et, sonra mergedHtml'i section'lardan yeniden kur. Böylece link section'da kalıcı olur ve gelecekteki birleştirmelerde asla ezilmez. InternalLink tablosuna regex ile yeniden giydirme YAPMA.

### 6C. B6 — status casing standardı
`ArticlePlan.status` her yerde **küçük harf** olsun. `strategy_complete`'te `status: 'PLANNED'` → `status: 'planned'`. Tüm `'PLANNED'`/`'IN_PROGRESS'` vb. string karşılaştırmalarını grep'le ve küçük harfe çevir.

### 6D. M3 — Kullanılmayan markdownContent'i kaldır
`markdownContent` hiçbir yerde anlamlı kullanılmıyor (boş yazılıyor).
- **`prisma/schema.prisma`**: `Article.markdownContent` ve `ArticleSection.markdownContent` alanlarını **sil**. `db push`.
- **`src/app/api/internal/jobs/route.ts`**: `markdownContent: ''` yazan upsert dallarını kaldır.
- Başka referans varsa grep'leyip temizle.

### 6E. M6 — Webhook payload validasyonu (zod)
- `zod`'u pinli ekle: `npm i zod@3.23.8` (mevcut majörle uyumlu en yakın sürümü kullan).
- **`src/app/api/internal/jobs/route.ts`**: her `action` için minimal bir zod şeması tanımla ve `body`'yi parse et; geçersizse `400 { error: 'Invalid payload' }` dön. En azından `section_complete` için `{ articleId: string, order: number, headingTitle: string, htmlContent: string, wordCount: number, headingLevel?: number }` zorunlu.

### 6F. slug benzersizliği
**`prisma/schema.prisma` → `model Article`**: `@@unique([projectId, slug])` ekle. `db push`. (Çakışma riskine karşı, üretimde slug ataması yaparken çakışırsa sonuna `-2`, `-3` ekleyen küçük bir yardımcı düşün — opsiyonel.)

**Doğrulama:** `tsc` geçer; geçersiz webhook payload'u 400 alır; aynı projede iki makale aynı slug'ı alamaz; retro-link bir section yeniden yazılınca silinmiyor.

---

## FAZ 7 — Şema hijyeni & tutarlılık (m1, drift, index, updatedAt, KB state, versiyon)

### 7A. m1 — Timing-safe token karşılaştırması
**`src/app/api/internal/jobs/route.ts`** auth kontrolünü sabit-zamanlı yap:
```ts
import { timingSafeEqual } from 'crypto';
function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
// kullanım:
if (!authHeader || !secretToken || !safeEqual(authHeader, `Bearer ${secretToken}`)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### 7B. Alan drift'ini temizle (önce grep!)
- **`ArticlePlan`**: `primaryKeyword` ile `focusKeyword` ikisi de var. `focusKeyword`'ü tut, `primaryKeyword`'ü **sil** (referansları grep'leyip `focusKeyword`'e taşı).
- **`Strategy`**: kullanılmayan eski alanları (`summary`, `targetKeywords`, `contentPillars`, `contentMix`, `monthlyTarget`) grep'le; **hiçbir yerde okunmuyorsa sil** (yeni alanlar `pillarFocus`, `keywordClusters`, `geoTargets` kalır). Okunuyorsa dokunma, sadece raporla.
- **`ContentPlan.strategyId`**: gevşek string yerine ilişkiye çevir: `strategy Strategy? @relation(fields: [strategyId], references: [id])`. (Strategy tarafında karşılık alan ekleme; tek yönlü opsiyonel ilişki yeterli — Prisma gerektirirse `@relation` adı ver.)
- Her değişiklikten sonra `db push`.

### 7C. Index + updatedAt
- FK alanlarına `@@index` ekle: `Competitor(projectId)`, `ContentSource(projectId)`, `InternalLink(sourcePlanId)`, `InternalLink(targetPlanId)`, `ContentRule(knowledgeBaseId)`, `ContentPillar(knowledgeBaseId)`, `OutboundLink(knowledgeBaseId)`, `ArticlePlan(contentPlanId)`.
- `updatedAt DateTime @updatedAt` ekle: `Competitor`, `SiteAudit`, `ContentPlan`, `ArticlePlan`, `InternalLink`, `CMSConnection`.
- `db push`.

### 7D. ArticleVersion snapshot'ını tamamla
**`model ArticleVersion`**'a `faq Json?` ve `schemaMarkup Json?` ekle. `section_complete`'teki yedekleme bloğunda (rewrite tespitinde) bu alanları da doldur (`existingArticle.faq`, `existingArticle.schemaMarkup`). `db push`.

### 7E. KB review state'i
**`enum ProjectState`**'e `KNOWLEDGE_BASE_REVIEW` ekle. `constitution_complete` handler'ında proje state'ini `'SOURCES_ANALYZED'` yerine `'KNOWLEDGE_BASE_REVIEW'` yap (KB DRAFT → insan onayı bekliyor anlamı netleşsin). KB approve route'u (`knowledge-base/approve`) onay sonrası state'i bir sonraki uygun aşamaya çeksin (ör. `SOURCES_ANALYZED` veya doğrudan strateji üretimine hazır state). `db push`.

**Doğrulama:** `tsc` + `db push` temiz; drift alanları kalmadı; KB onay bekleyen proje `KNOWLEDGE_BASE_REVIEW` state'inde görünüyor.

---

## FAZ 8 — Repo hijyeni (dead code, deps, gitignore, README)

### 8A. Ölü kod
- `src/lib/pipeline/strategy-planner.ts` artık kullanılmıyorsa (strateji Celery'de) **sil** (önce `grep -rn "strategy-planner" src` ile referansları doğrula).
- Faz 4'te kaynak analizi worker'a taşındıysa, `source-analyzers.ts`'in artık çağrılmayan senkron LLM fonksiyonlarını temizle (scraping yardımcıları kalabilir).

### 8B. requirements.txt pinleme
**`worker/requirements.txt`**'teki paketleri kurulu sürümlerle pinle (`worker/.venv` içindeki `*.dist-info` sürümlerine bak; ör. `celery==5.3.x`, `redis==5.x`, vb.). Belirsizse `pip freeze` çıktısındaki sürümleri kullan.

### 8C. .gitignore + secret temizliği
- **`.gitignore`**'a ekle (yoksa): `.env`, `.env.local`, `.env*.local`, `worker/.env`, `**/.venv/`, `**/__pycache__/`, `*.db`, `prisma/*.db`, `next-env.d.ts`, `tsconfig.tsbuildinfo`.
- Repodan izlerini kaldır: `git rm --cached -r --ignore-unmatch worker/.venv worker/__pycache__ .env worker/.env dev.db prisma/dev.db`.
- README/commit mesajında kullanıcıya **not bırak:** "worker/.env paylaşıldığı için `GEMINI_API_KEY` ve `INTERNAL_SECRET_TOKEN` rotate edilmeli."
- `.env.example` ve `worker/.env.example` oluştur (gerçek değer olmadan, sadece anahtar adları).

### 8D. README'yi v2'ye güncelle
- Kökteki `README.md` hâlâ v1 (User-bazlı şema, Faz 1→3, çift schema bloğu). Onu mevcut gerçeklikle değiştir: faz yapısı 1.5.5 (tenant) → 1.6 (KB/grounding) → 1.7 (strateji+link) → 1.8 (üretim+quality gate) → 1.9 (rakip/gap/editöryel) → 2 (auth/SaaS). Şemanın **verbatim** kopyasını README'den çıkar; tek doğruluk kaynağı `prisma/schema.prisma` olsun (README sadece referans versin).
- `README.old.md` dosyasını **sil**.

**Doğrulama:** `git status` artık `.env`/`.venv`/`*.db` göstermiyor; README v2 ve şema ile tutarlı.

---

## SON KONTROL (tüm fazlar bitince)
1. `npx prisma validate && npx prisma generate && npx prisma db push` — temiz.
2. `npx tsc --noEmit` (veya `npm run build`) — hatasız.
3. Worker: `cd worker && python -c "import tasks"` — import hatası yok; `celery -A main worker --loglevel=info -c 1` görevleri register ediyor.
4. Uçtan uca duman testi (mock modda): proje → kaynak analizi (202) → KB DRAFT → KB APPROVED → strateji (REVIEW) → onay → 1 makale section-by-section (doğru dil + doğru heading level) → produce (quality gate gerçek metriklerle) → mock WP draft. FAILED senaryosu: bir görevi bilinçli patlat, `state=FAILED` + `lastError` dolmalı.
5. Her fazın commit'i ayrı; özet bir kapanış mesajı yaz.

> Çalışmaya **FAZ 1**'den başla. Her fazı bitirince dur, ne yaptığını ve doğrulama sonucunu özetle, sonraki faza geçmek için onay bekle.
