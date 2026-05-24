import * as cheerio from 'cheerio';
import { generateContent } from '../gemini';

export interface BaseAnalysisResult {
  brandName: string;
  toneOfVoice: string;
  targetAudience: string;
  coreTopics: string[];
  summary: string;
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
 * Analyzes a Website URL by crawling its homepage and extracting metadata and content
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
    
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim() || '';
    
    const headings: string[] = [];
    $('h1, h2, h3').slice(0, 15).each((_, el) => {
      const text = $(el).text().trim();
      if (text) headings.push(text);
    });

    // Extract raw text, clean up spaces, truncate
    $('script, style, nav, footer, noscript').remove();
    const cleanText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000);

    const prompt = `
    Aşağıdaki web sitesi içeriğini analiz et ve sitenin marka profili, sektörü, tonu ve ana başlıklarını çıkar.
    Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
    
    WEB SİTESİ URL: ${targetUrl}
    SİTE BAŞLIĞI: ${title}
    META AÇIKLAMASI: ${description}
    KAZILAN BAŞLIKLAR (H1-H3): ${headings.join(' | ')}
    
    METİN İÇERİĞİNDEN KESİT:
    ${cleanText}
    
    Lütfen şu şemaya göre JSON döndür:
    {
      "brandName": "Marka/Site Adı",
      "industry": "Hangi sektör/niş?",
      "toneOfVoice": "Yazım dili ve tonu (örn: Profesyonel, samimi, eğlenceli, otoriter)",
      "targetAudience": "Hedef kitle tanımı",
      "coreTopics": ["Konu 1", "Konu 2", "Konu 3"],
      "detectedKeywords": ["anahtar kelime 1", "anahtar kelime 2"],
      "summary": "Sitenin amacı ve içeriği hakkında kısa bir özet"
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
