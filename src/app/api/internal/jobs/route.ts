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
      // Editöryel revizyon için: Eski halini ArticleVersion olarak yedekle (Eğer daha önce içerik varsa)
      const existingArticle = await prisma.article.findUnique({
        where: { id: articleId },
        include: { sections: true }
      });
      
      const existingSection = existingArticle?.sections.find(s => s.order === order);
      const isRewrite = !!existingSection;
      
      if (isRewrite && existingArticle?.htmlContent) {
        await prisma.articleVersion.create({
          data: {
            articleId,
            versionNumber: existingArticle.currentVersion,
            htmlContent: existingArticle.htmlContent,
            wpInstructions: existingArticle.wpInstructions as any,
            changeNote: body.changeNote || `Otomatik yedek: Bölüm ${order} yeniden yazıldı.`
          }
        });
        
        await prisma.article.update({
          where: { id: articleId },
          data: { currentVersion: { increment: 1 } }
        });
      }

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
          state: isComplete ? 'IMAGES_GENERATING' : 'WRITING'
        }
      });
      
      if (isComplete) {
        // Fetch project and KB
        const proj = await prisma.project.findUnique({
          where: { id: projectId || existingArticle?.projectId },
          include: { knowledgeBase: true }
        });
        
        const kbStr = JSON.stringify(proj?.knowledgeBase || {});
        
        // Trigger Phase 1.8 Factory (Bu aynı zamanda Kalite Kapısını da çalıştıracak)
        const { sendCeleryTask } = await import('@/lib/celery');
        await sendCeleryTask('tasks.produce_article_factory', [articleId, mergedHtml, kbStr, proj?.id || projectId]);
      }
      
      return NextResponse.json({ success: true });
    }
    
    if (action === 'constitution_complete') {
      const { projectId, siteAuditId, constitution: constitutionStr } = body;
      const data = JSON.parse(constitutionStr);

      // Veritabanı yazım işlemlerini atomik transaction altında yürüt
      await prisma.$transaction(async (tx) => {
        // 1. Varsa eski KnowledgeBase ve alt kurallarını tamamen temizle (Idempotency)
        const existingKb = await tx.knowledgeBase.findUnique({ where: { projectId } });
        if (existingKb) {
          await tx.contentRule.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.contentPillar.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.outboundLink.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.knowledgeBase.delete({ where: { projectId } });
        }

        // 2. Ana KnowledgeBase kaydını oluştur (DRAFT durumunda)
        const kb = await tx.knowledgeBase.create({
          data: {
            projectId,
            verifiedFacts: data.verified_facts,
            brandEntities: data.brand_entities,
            writingInstructions: data.writing_instructions,
            generatedChecklist: data.generated_checklist,
            status: 'DRAFT', // İnsan onayı bekliyor
          }
        });

        // 3. Alt kuralları (ContentRule) ilişkisel olarak doldur
        if (data.rules && data.rules.length > 0) {
          await tx.contentRule.createMany({
            data: data.rules.map((r: any) => ({
              knowledgeBaseId: kb.id,
              type: r.type, // FORBIDDEN_PHRASE, FACT_CORRECTION, REQUIRED, STYLE
              value: r.value,
              reason: r.reason,
              evidence: r.source_url ? { sourceUrl: r.source_url } : {},
              origin: 'AI_DERIVED'
            }))
          });
        }

        // 4. İçerik silolarını (ContentPillar) kaydet
        if (data.pillars && data.pillars.length > 0) {
          await tx.contentPillar.createMany({
            data: data.pillars.map((p: any) => ({
              knowledgeBaseId: kb.id,
              name: p.name,
              scope: p.scope
            }))
          });
        }

        // 5. Güvenilir dış linkleri (OutboundLink) kaydet
        if (data.outbound_links && data.outbound_links.length > 0) {
          await tx.outboundLink.createMany({
            data: data.outbound_links.map((ol: any) => ({
              knowledgeBaseId: kb.id,
              url: ol.url,
              title: ol.title,
              usageArea: ol.usage_area
            }))
          });
        }

        // 6. Projenin durumunu SOURCES_ANALYZED aşamasına yükselt
        await tx.project.update({
          where: { id: projectId },
          data: { state: 'SOURCES_ANALYZED' }
        });
      });

      return NextResponse.json({ success: true, message: 'KnowledgeBase successfully generated in DRAFT state.' });
    }
    
    if (action === 'strategy_complete') {
      const { projectId, strategy_data: strategyStr } = body;
      const data = JSON.parse(strategyStr);

      await prisma.$transaction(async (tx) => {
        // Idempotency: Varsa eski Strategy, ContentPlan ve ArticlePlan kayıtlarını temizle
        const oldStrategy = await tx.strategy.findUnique({ where: { projectId } });
        if (oldStrategy) {
          await tx.contentPlan.deleteMany({ where: { strategyId: oldStrategy.id } });
          await tx.strategy.delete({ where: { projectId } });
        }

        // 1. Ana Strategy kaydını oluştur
        const strategy = await tx.strategy.create({
          data: {
            projectId,
            pillarFocus: data.pillar_focus,
            keywordClusters: data.keyword_clusters,
            geoTargets: data.geo_targets
          }
        });

        // 2. ContentPlan oluştur
        const contentPlan = await tx.contentPlan.create({
          data: {
            projectId,
            strategyId: strategy.id,
            status: 'DRAFT'
          }
        });

        // 3. Makale Planlarını (ArticlePlan) tek tek ekle ve slug-id eşleşme haritası tut
        const slugToIdMap: Record<string, string> = {};
        for (const art of data.articles) {
          const plan = await tx.articlePlan.create({
            data: {
              projectId,
              contentPlanId: contentPlan.id,
              slug: art.slug,
              title: art.title,
              contentType: art.contentType,
              focusKeyword: art.focusKeyword,
              secondaryKeywords: art.secondaryKeywords,
              outline: art.outline,
              order: art.order,
              status: 'PLANNED'
            }
          });
          slugToIdMap[art.slug] = plan.id;
        }

        // 4. İç Link Haritasını (InternalLink) eşleşme haritasına göre veritabanına bas
        if (data.internal_links && data.internal_links.length > 0) {
          const linksToCreate = data.internal_links
            .filter((l: any) => slugToIdMap[l.source_slug] && slugToIdMap[l.target_slug])
            .map((l: any) => ({
              sourcePlanId: slugToIdMap[l.source_slug],
              targetPlanId: slugToIdMap[l.target_slug],
              anchorText: l.anchor_text,
              status: 'planned'
            }));

          await tx.internalLink.createMany({ data: linksToCreate });
        }

        // 5. Durumu 'STRATEGY_REVIEW' (İnsan Onayı Bekliyor) aşamasına çek (Katı Kurallara tam uyum!)
        await tx.project.update({
          where: { id: projectId },
          data: { state: 'STRATEGY_REVIEW' }
        });
      });

      return NextResponse.json({ success: true, message: 'Strategy and internal link graph generated for human review.' });
    }
    
    if (action === 'production_complete') {
      const { articleId, components, qualityGateResult } = body;
      
      const componentsData = typeof components === 'string' ? JSON.parse(components) : components;

      const updatedArticle = await prisma.article.update({
        where: { id: articleId },
        data: {
          wpInstructions: componentsData.seo_wp,
          faq: componentsData.faqs,
          geoReference: { citationHtml: componentsData.geo_citation_html },
          schemaMarkup: componentsData.schema_json_ld,
          qualityGate: qualityGateResult, // passed, score, failures, metrics
          state: qualityGateResult.passed ? 'PREVIEW_READY' : 'SEO_AUDIT',
          wordCount: qualityGateResult.metrics.wordCount
        },
        include: {
          project: {
            include: {
              organization: { include: { cmsConnections: true } }
            }
          }
        }
      });
      
      // Auto WP Draft sync if this is an editorial rewrite (currentVersion > 1) and quality gate passed
      if (qualityGateResult.passed && updatedArticle.currentVersion > 1) {
        let fullHtml = updatedArticle.htmlContent || '';
        if (updatedArticle.faq && Array.isArray(updatedArticle.faq) && updatedArticle.faq.length > 0) {
          fullHtml += '\n\n<h2>Sıkça Sorulan Sorular</h2>\n';
          updatedArticle.faq.forEach((f: any) => {
            fullHtml += `<h3>${f.question}</h3>\n<p>${f.answer}</p>\n`;
          });
        }

        const wpPayload = {
          title: componentsData.seo_wp?.meta_title || updatedArticle.title,
          content: fullHtml,
          status: 'draft',
          slug: componentsData.seo_wp?.wp_slug || updatedArticle.slug,
        };

        const wpConnection = updatedArticle.project.organization.cmsConnections.find(c => c.type === 'wordpress');
        const connectionConfig = wpConnection ? {
          url: wpConnection.siteUrl,
          credentials: wpConnection.credentials
        } : {
          url: 'https://mock.wordpress.com',
          credentials: 'mock_user:mock_pass'
        };

        const { sendCeleryTask } = await import('@/lib/celery');
        await sendCeleryTask('tasks.publish_to_wordpress', [articleId, wpPayload, connectionConfig]);
      }
      
      return NextResponse.json({ success: true, message: 'Article production and quality gate evaluation complete.' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
