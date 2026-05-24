import { prisma } from '../db/prisma';
import { generateContent } from '../gemini';

export interface UnifiedStrategyResult {
  strategy: {
    summary: string;
    targetKeywords: any; // JSON
    contentPillars: any; // JSON
    geoTargets: any; // JSON
    contentMix: { informational: number; transactional: number; local: number; [key: string]: number };
    monthlyTarget: number;
  };
  articlePlans: Array<{
    title: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    searchIntent: string;
    contentType: string;
    targetWordCount: number;
    priority: string;
    geoTarget?: string;
    outline: Array<{ title: string; level: number }>;
    rationale: string;
  }>;
}

/**
 * Generates a unified strategy and content plan from all project sources
 */
export async function generateUnifiedStrategy(projectId: string): Promise<any> {
  // 1. Fetch sources
  const sources = await prisma.contentSource.findMany({
    where: { projectId, status: 'ANALYZED' }
  });

  if (sources.length === 0) {
    throw new Error('Analiz edilmiş hiçbir dijital kaynak bulunamadı. Lütfen önce kaynak ekleyin ve analiz edin.');
  }

  // 2. Format source details into prompt context
  const sourcesContext = sources.map((source, index) => {
    const data: any = source.extractedData || {};
    return `
=== KAYNAK #${index + 1}: ${source.displayName} (${source.type}) ===
Marka Adı: ${data.brandName || 'Belirtilmedi'}
Sektör/Niş: ${data.industry || 'Belirtilmedi'}
Ton ve Tarz: ${data.toneOfVoice || 'Belirtilmedi'}
Hedef Kitle: ${data.targetAudience || 'Belirtilmedi'}
Ana Konular: ${(data.coreTopics || []).join(', ')}
Özet: ${data.summary || 'Belirtilmedi'}
${data.recentVideoInsights ? `Son İçerik Fikirleri:\n${data.recentVideoInsights.map((v: any) => `- Video: ${v.title} (${v.keyTakeaway})`).join('\n')}` : ''}
`;
  }).join('\n');

  const prompt = `
  Aşağıda bir markanın farklı kanallardaki dijital ayak izine ait analiz verileri listelenmiştir.
  Bu kaynakları birleştirerek, markanın kurumsal web sitesi için bir **Birleşik SEO/GEO İçerik Stratejisi** ve **İçerik Planı (Makale Fikirleri)** oluştur.
  
  KAYNAKLARIN ÖZETLERİ:
  ${sourcesContext}
  
  GÖREVLERİN:
  1. Bu kanallardaki ton, kitle ve temaları birleştiren uyumlu tek bir marka profili oluştur.
  2. Ortak anahtar kelime öbekleri (Keyword Clusters) belirle.
  3. Ana içerik kategorilerini (Content Pillars) belirle.
  4. Sitede yayınlanacak 3 adet özgün, SEO/GEO uyumlu makale planı üret. 
     - Makale fikirleri, varsa YouTube veya diğer kaynaklardaki popüler konuları blog yazısına dönüştürerek kanallar arası köprü kurmalı veya web sitesindeki eksiklikleri tamamlamalıdır.
     - Her makale fikri için H2/H3 başlıklarını içeren yapılandırılmış bir taslak (Outline) oluştur.
     
  Kesinlikle sadece JSON formatında yanıt ver. Yanıtın başka hiçbir metin içermemelidir.
  
  Lütfen şu şemaya göre JSON döndür:
  {
    "strategy": {
      "summary": "Tüm platformları entegre eden genel strateji özeti.",
      "targetKeywords": [
        { "cluster": "Küme Adı", "keywords": ["kelime 1", "kelime 2"] }
      ],
      "contentPillars": ["Kategori 1", "Kategori 2"],
      "geoTargets": ["TR", "Küresel"],
      "contentMix": { "informational": 50, "transactional": 30, "local": 20 },
      "monthlyTarget": 4
    },
    "articlePlans": [
      {
        "title": "SEO Uyumlu Blog Başlığı (Çarpıcı ve tıklanabilir)",
        "primaryKeyword": "anahtar kelime",
        "secondaryKeywords": ["kelime a", "kelime b"],
        "searchIntent": "informational", 
        "contentType": "guide",
        "targetWordCount": 1000,
        "priority": "high",
        "geoTarget": "TR",
        "outline": [
          { "title": "1. Giriş", "level": 2 },
          { "title": "2. Alt Başlık", "level": 2 },
          { "title": "3. Sonuç", "level": 2 }
        ],
        "rationale": "Bu makalenin neden yazılması gerektiğinin açıklaması (örn: YouTube'daki popüler videodan dönüştürüldü)"
      }
    ]
  }
  `;

  // 3. Call Gemini
  const geminiResponse = await generateContent(prompt, true);
  const parsedData: UnifiedStrategyResult = JSON.parse(geminiResponse);

  // 4. Save/Upsert Strategy in DB
  const strategy = await prisma.strategy.upsert({
    where: { projectId },
    update: {
      summary: parsedData.strategy.summary,
      targetKeywords: parsedData.strategy.targetKeywords,
      contentPillars: parsedData.strategy.contentPillars,
      geoTargets: parsedData.strategy.geoTargets,
      contentMix: parsedData.strategy.contentMix,
      monthlyTarget: parsedData.strategy.monthlyTarget,
      version: { increment: 1 }
    },
    create: {
      projectId,
      summary: parsedData.strategy.summary,
      targetKeywords: parsedData.strategy.targetKeywords,
      contentPillars: parsedData.strategy.contentPillars,
      geoTargets: parsedData.strategy.geoTargets,
      contentMix: parsedData.strategy.contentMix,
      monthlyTarget: parsedData.strategy.monthlyTarget,
      version: 1
    }
  });

  // 5. Clean up existing ContentPlan, ArticlePlans and Articles to prevent conflicts
  const existingPlan = await prisma.contentPlan.findUnique({
    where: { projectId },
    include: { articles: true }
  });

  if (existingPlan) {
    const planIds = existingPlan.articles.map(a => a.id);
    // Delete sections, versions, articles
    await prisma.articleSection.deleteMany({ where: { articleId: { in: planIds } } });
    await prisma.articleVersion.deleteMany({ where: { articleId: { in: planIds } } });
    await prisma.article.deleteMany({ where: { articlePlanId: { in: planIds } } });
    await prisma.articlePlan.deleteMany({ where: { contentPlanId: existingPlan.id } });
    await prisma.contentPlan.delete({ where: { id: existingPlan.id } });
  }

  // 6. Create new ContentPlan
  const contentPlan = await prisma.contentPlan.create({
    data: {
      projectId
    }
  });

  // 7. Save ArticlePlans and link them to new Article placeholders
  const generatedArticles = [];
  for (let i = 0; i < parsedData.articlePlans.length; i++) {
    const planData = parsedData.articlePlans[i];
    
    // Create ArticlePlan record
    const articlePlan = await prisma.articlePlan.create({
      data: {
        contentPlanId: contentPlan.id,
        order: i + 1,
        title: planData.title,
        primaryKeyword: planData.primaryKeyword,
        secondaryKeywords: JSON.stringify(planData.secondaryKeywords),
        searchIntent: planData.searchIntent,
        contentType: planData.contentType,
        targetWordCount: planData.targetWordCount,
        priority: planData.priority,
        geoTarget: planData.geoTarget || null,
        outline: planData.outline,
        status: 'planned'
      }
    });

    // Generate clean slug
    const slug = planData.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    // Create corresponding Article placeholder in OUTLINE_APPROVED state (ready to generate sections)
    const article = await prisma.article.create({
      data: {
        projectId,
        articlePlanId: articlePlan.id,
        title: planData.title,
        slug,
        metaDescription: `${planData.title} hakkında detaylı SEO uyumlu rehber.`,
        htmlContent: '',
        markdownContent: '',
        focusKeyword: planData.primaryKeyword,
        wordCount: 0,
        state: 'OUTLINE_APPROVED',
        currentVersion: 1
      }
    });
    
    generatedArticles.push({ articlePlan, article });
  }

  // Update project state
  await prisma.project.update({
    where: { id: projectId },
    data: { state: 'SOURCES_ANALYZED' }
  });

  return {
    strategy,
    contentPlan,
    articles: generatedArticles
  };
}
