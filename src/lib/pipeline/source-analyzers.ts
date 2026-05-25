import * as cheerio from 'cheerio';
import { generateContent } from '../gemini';

export interface AuditBreakdownItem {
  score: number;
  good: string;
  bad: string;
}

export interface AuditResult {
  totalScore: number;
  breakdown: {
    metadata: AuditBreakdownItem;
    hierarchy: AuditBreakdownItem;
    depth: AuditBreakdownItem;
    geoEntity: AuditBreakdownItem;
  };
}

export interface BaseAnalysisResult {
  brandName: string;
  industry: string;
  detectedArchetype: 'PORTFOLIO_AUTHORITY' | 'CONTENT_CREATOR' | 'LOCAL_SERVICE' | 'PRODUCT_BRAND' | 'KNOWLEDGE_LEADER';
  toneOfVoice: string;
  targetAudience: string;
  coreTopics: string[];
  detectedKeywords: string[];
  summary: string;
  audit: AuditResult;
  actionPlan: string[];
  [key: string]: any;
}

/**
 * Extracts handle or channel ID from a YouTube input string
 */
export function parseYouTubeInput(input: string): { handle?: string; channelId?: string } {
  const cleanInput = input.trim();
  
  // Check for channel ID format
  const channelIdMatch = cleanInput.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_\-]+)/i);
  if (channelIdMatch) {
    return { channelId: channelIdMatch[1] };
  }
  
  // Check for URL handle format
  const urlHandleMatch = cleanInput.match(/youtube\.com\/@([a-zA-Z0-9_\-\.]+)/i);
  if (urlHandleMatch) {
    return { handle: urlHandleMatch[1] };
  }
  
  // Check for @handle format
  if (cleanInput.startsWith('@')) {
    return { handle: cleanInput.substring(1) };
  }
  
  // Default to handle if no slash/url format
  if (!cleanInput.includes('/') && !cleanInput.includes('.')) {
    return { handle: cleanInput };
  }
  
  return { handle: cleanInput };
}

/**
 * Analyzes a Website URL by crawling its homepage and extracting metadata and content,
 * then runs a 100-point Technical Health, SEO & GEO Audit Scoring Matrix via Gemini.
 */
export async function analyzeWebsite(url: string): Promise<BaseAnalysisResult> {
  try {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      next: { revalidate: 3600 }
    });

    if (!response.ok) {
      throw new Error(`Web sitesi getirilemedi: HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    // --- Enhanced metadata extraction ---
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim() || '';
    const htmlLang = $('html').attr('lang') || '';
    const charset = $('meta[charset]').attr('charset') || $('meta[http-equiv="Content-Type"]').attr('content') || '';

    // Structured heading extraction with tag names
    const structuredHeadings: { tag: string; text: string }[] = [];
    $('h1, h2, h3, h4').slice(0, 25).each((_, el) => {
      const text = $(el).text().trim();
      const tag = (el as any).tagName?.toUpperCase() || $(el).prop('tagName')?.toUpperCase() || '';
      if (text) structuredHeadings.push({ tag, text });
    });

    // Count H1 tags specifically for the scoring matrix
    const h1Count = $('h1').length;
    const h1Texts = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);

    // Extract raw body text for word count and depth analysis
    $('script, style, nav, footer, noscript, iframe, svg').remove();
    const cleanText = $('body').text().replace(/\s+/g, ' ').trim();
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const textSnippet = cleanText.substring(0, 10000);

    // Format headings for prompt
    const headingsList = structuredHeadings.map(h => `[${h.tag}] ${h.text}`).join('\n');

    const prompt = `
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
WEB SİTESİ URL: ${targetUrl}
SİTE BAŞLIĞI (TITLE ETİKETİ): ${title || '(YOK)'}
TITLE KARAKTER UZUNLUĞU: ${title.length}
META DESCRIPTION: ${description || '(YOK)'}
META DESCRIPTION KARAKTER UZUNLUĞU: ${description.length}
HTML DİL ÖZNİTELİĞİ (lang): ${htmlLang || '(YOK)'}
KARAKTER SETİ: ${charset || '(TESPİT EDİLEMEDİ)'}
H1 ETİKETİ SAYISI: ${h1Count}
H1 METİNLERİ: ${h1Texts.length > 0 ? h1Texts.join(' | ') : '(YOK)'}
TEMİZ KELİME SAYISI: ${wordCount}

BAŞLIK HİYERARŞİSİ (Etiket ve Metin):
${headingsList || '(BAŞLIK BULUNAMADI)'}

METİN İÇERİĞİNDEN KESİT (ilk ~10000 karakter):
${textSnippet}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ZORUNLU JSON ÇIKTI ŞEMASI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
{
  "brandName": "Marka/Site Adı",
  "industry": "Sektör/Niş",
  "detectedArchetype": "PORTFOLIO_AUTHORITY | CONTENT_CREATOR | LOCAL_SERVICE | PRODUCT_BRAND | KNOWLEDGE_LEADER (birini seç)",
  "toneOfVoice": "Yazım dili ve tonu",
  "targetAudience": "Hedef kitle tanımı",
  "coreTopics": ["Konu 1", "Konu 2", "Konu 3"],
  "detectedKeywords": ["anahtar kelime 1", "anahtar kelime 2"],
  "summary": "Sitenin amacı ve içeriği hakkında kısa bir özet",
  "audit": {
    "totalScore": 0,
    "breakdown": {
      "metadata": { "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" },
      "hierarchy": { "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" },
      "depth": { "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" },
      "geoEntity": { "score": 0, "good": "Olumlu bulgu", "bad": "Olumsuz bulgu" }
    }
  },
  "actionPlan": ["Eylem 1", "Eylem 2", "Eylem 3"]
}
    `;

    const geminiResponse = await generateContent(prompt, true);
    return JSON.parse(geminiResponse) as BaseAnalysisResult;
  } catch (error: any) {
    throw new Error(`Website Analiz Hatası: ${error.message}`);
  }
}

/**
 * Analyzes a YouTube Channel (API v3 with simulated fallback)
 */
export async function analyzeYouTube(handleOrUrl: string): Promise<BaseAnalysisResult & { channelStats?: any }> {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY;
  const { handle, channelId } = parseYouTubeInput(handleOrUrl);
  
  if (!apiKey) {
    return runSimulatedYouTubeAnalysis(handleOrUrl, "API Key bulunamadı.");
  }
  
  try {
    let resolvedChannelId = channelId;
    let channelTitle = '';
    let channelDescription = '';
    let subscriberCount = '0';
    let videoCount = '0';
    
    // 1. Resolve Channel Info
    let channelUrl = '';
    if (resolvedChannelId) {
      channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${resolvedChannelId}&key=${apiKey}`;
    } else if (handle) {
      // Handles require the @ in the forHandle parameter in standard YT API
      const handleParam = handle.startsWith('@') ? handle : `@${handle}`;
      channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${handleParam}&key=${apiKey}`;
    } else {
      throw new Error('Geçersiz YouTube girdisi.');
    }
    
    const channelRes = await fetch(channelUrl);
    if (!channelRes.ok) {
      throw new Error(`YouTube API Kanal hatası: HTTP ${channelRes.status}`);
    }
    
    const channelData = await channelRes.json();
    const channelItem = channelData.items?.[0];
    
    if (!channelItem) {
      // Fallback if handle search fails (sometimes API handles fail due to regional setups)
      if (handle) {
        return runSimulatedYouTubeAnalysis(handleOrUrl, `API ile '${handle}' kanalı bulunamadı. Simüle ediliyor.`);
      }
      throw new Error('Kanal bulunamadı.');
    }
    
    resolvedChannelId = channelItem.id;
    channelTitle = channelItem.snippet.title;
    channelDescription = channelItem.snippet.description || '';
    subscriberCount = channelItem.statistics.subscriberCount || '0';
    videoCount = channelItem.statistics.videoCount || '0';
    
    // 2. Fetch Latest 5 Videos using Uploads Playlist
    let recentVideos: any[] = [];
    if (resolvedChannelId) {
      // YouTube Channel ID starts with UC, uploads playlist starts with UU
      const uploadsPlaylistId = 'UU' + resolvedChannelId.substring(2);
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=${uploadsPlaylistId}&key=${apiKey}`;
      
      const playlistRes = await fetch(playlistUrl);
      if (playlistRes.ok) {
        const playlistData = await playlistRes.json();
        recentVideos = (playlistData.items || []).map((item: any) => ({
          title: item.snippet.title,
          description: item.snippet.description || '',
          publishedAt: item.snippet.publishedAt
        }));
      }
    }
    
    const prompt = `
    Aşağıdaki YouTube kanalı ve son videoları hakkında bilgi verildi. Bu verileri analiz et, kanalın tarzını, tonunu, ana konularını ve hedef kitlesini çıkar.
    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
    
    KANAL ADI: ${channelTitle}
    AÇIKLAMA: ${channelDescription}
    ABONE SAYISI: ${subscriberCount}
    VİDEO SAYISI: ${videoCount}
    
    SON 5 VİDEO:
    ${recentVideos.map((v, i) => `${i+1}. BAŞLIK: ${v.title}\nAÇIKLAMA: ${v.description.substring(0, 300)}...\n`).join('\n')}
    
    Lütfen şu şemaya göre JSON döndür:
    {
      "brandName": "${channelTitle}",
      "toneOfVoice": "Kanalın konuşma tonu ve tarzı (örn: Eğitici, samimi, dinamik, sohbet havasında)",
      "targetAudience": "İzleyici kitlesi tanımı",
      "coreTopics": ["Konu 1", "Konu 2", "Konu 3"],
      "recentVideoInsights": [
        { "title": "Video Başlığı", "keyTakeaway": "Videodan çıkarılan ana fikir veya blog yazısı olabilecek konu başlığı" }
      ],
      "summary": "Kanalın içeriği ve temaları hakkında genel özet"
    }
    `;
    
    const geminiResponse = await generateContent(prompt, true);
    const result = JSON.parse(geminiResponse);
    
    return {
      ...result,
      channelStats: {
        subscriberCount: parseInt(subscriberCount),
        videoCount: parseInt(videoCount),
        channelId: resolvedChannelId
      }
    };
    
  } catch (error: any) {
    console.error('YouTube API Hatası:', error.message);
    return runSimulatedYouTubeAnalysis(handleOrUrl, `YouTube API hatası: ${error.message}. Simüle ediliyor.`);
  }
}

/**
 * Fallback simulator when YouTube API is not working
 */
async function runSimulatedYouTubeAnalysis(handleOrUrl: string, reason: string): Promise<BaseAnalysisResult & { channelStats: any }> {
  const cleanInput = handleOrUrl.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '');
  
  const prompt = `
    Kullanıcı şu YouTube kanalını analiz etmemizi istedi: "${cleanInput}".
    YouTube API şu sebeple kullanılamadı: "${reason}".
    Kanal isminden veya kullanıcı girdisinden yola çıkarak bu kanalın ne hakkında olabileceğini, tonunu ve hedef kitlesini simüle et/tahmin et.
    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
    
    Lütfen şu şemaya göre JSON döndür:
    {
      "brandName": "${cleanInput} (YouTube)",
      "toneOfVoice": "Tahmini kanal tonu (örn: Dinamik, Samimi, Öğretici)",
      "targetAudience": "Tahmini hedef kitle",
      "coreTopics": ["Konu Fikri 1", "Konu Fikri 2"],
      "recentVideoInsights": [
        { "title": "Tahmini Popüler Video Başlığı", "keyTakeaway": "Kanal temasına uygun video fikri" }
      ],
      "summary": "Kanal ismi analiz edilerek tahmin edilen içerik odağı."
    }
  `;
  
  const geminiResponse = await generateContent(prompt, true);
  const result = JSON.parse(geminiResponse);
  return {
    ...result,
    channelStats: {
      subscriberCount: 25000, // Simulated default
      videoCount: 120,
      simulated: true,
      simulationReason: reason
    }
  };
}

/**
 * Analyzes Instagram bio/recent posts (accepts manual pasted text)
 */
export async function analyzeInstagram(username: string, rawText?: string): Promise<BaseAnalysisResult> {
  const profileName = username.trim().replace(/^@/, '');
  
  const prompt = `
  Aşağıdaki Instagram sayfası bilgilerini analiz et. Profil sahibi kimdir, ne tür içerikler üretir, tonu ve tarzı nedir, hedef kitlesi kimdir?
  Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
  
  INSTAGRAM KULLANICI ADI: @${profileName}
  KULLANICI METİN GİRDİSİ (BİO VE PAYLAŞIMLAR):
  ${rawText || 'Yazılı bir bilgi girilmedi. Profil adından yola çıkarak analiz et.'}
  
  Lütfen şu şemaya göre JSON döndür:
  {
    "brandName": "@${profileName}",
    "toneOfVoice": "Instagram profilinin tonu (örn: Görsel ağırlıklı, samimi, estetik, ilham verici, günlük)",
    "targetAudience": "Instagram takipçi kitlesi tanımı",
    "coreTopics": ["İçerik Konusu 1", "İçerik Konusu 2"],
    "summary": "Instagram profili ve içerik odağı hakkında genel özet"
  }
  `;
  
  const geminiResponse = await generateContent(prompt, true);
  return JSON.parse(geminiResponse) as BaseAnalysisResult;
}

/**
 * Analyzes custom context files/text
 */
export async function analyzeCustom(displayName: string, text: string): Promise<BaseAnalysisResult> {
  const prompt = `
  Kullanıcının yüklediği özel marka rehberi, doküman veya açıklama metnini analiz et. Markanın genel duruşunu, tonunu, kitle analizini ve stratejik hedeflerini özetle.
  Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
  
  DOKÜMAN ADI/TANIMI: ${displayName}
  DOKÜMAN METNİ:
  ${text.substring(0, 10000)}
  
  Lütfen şu şemaya göre JSON döndür:
  {
    "brandName": "${displayName}",
    "toneOfVoice": "Dokümandan anlaşılan marka tonu ve kuralları",
    "targetAudience": "Tanımlanan hedef kitle",
    "coreTopics": ["Odaklanılan Tema 1", "Odaklanılan Tema 2"],
    "summary": "Dokümanın sunduğu marka özeti ve hedefler"
  }
  `;
  
  const geminiResponse = await generateContent(prompt, true);
  return JSON.parse(geminiResponse) as BaseAnalysisResult;
}
