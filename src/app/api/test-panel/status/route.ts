import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

const TEST_PROJECT_ID = 'test-project-id';

// GET /api/test-panel/status — poll project state, sources, strategy, and articles
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedArticleId = searchParams.get('selectedArticleId');

    // 1. Fetch project with state and siteAudit
    const project = await prisma.project.findUnique({
      where: { id: TEST_PROJECT_ID },
      include: {
        siteAudit: true,
        knowledgeBase: {
          include: {
            rules: true,
            pillars: true,
            outboundLinks: true
          }
        }
      }
    });

    if (!project) {
      return NextResponse.json({
        exists: false,
        message: 'Test projesi bulunamadı. "Seed & Sıfırla" butonuna tıklayın.',
      });
    }

    // 2. Fetch all sources
    const sources = await prisma.contentSource.findMany({
      where: { projectId: TEST_PROJECT_ID },
      orderBy: { createdAt: 'desc' }
    });

    // 3. Fetch strategy and content plan
    const strategy = await prisma.strategy.findUnique({
      where: { projectId: TEST_PROJECT_ID }
    });

    const contentPlan = await prisma.contentPlan.findUnique({
      where: { projectId: TEST_PROJECT_ID }
    });

    // 4. Fetch all articles
    const articles = await prisma.article.findMany({
      where: { projectId: TEST_PROJECT_ID },
      include: {
        articlePlan: {
          include: {
            outboundLinks: {
              include: {
                targetPlan: true
              }
            }
          }
        },
        sections: { orderBy: { order: 'asc' } },
        versions: { orderBy: { versionNumber: 'desc' } }
      },
      orderBy: { createdAt: 'asc' }
    });

    // 5. Select active article
    let activeArticle = null;
    if (selectedArticleId) {
      activeArticle = articles.find(a => a.id === selectedArticleId) || null;
    }
    if (!activeArticle && articles.length > 0) {
      // Default to test-article-id if present, otherwise first article
      activeArticle = articles.find(a => a.id === 'test-article-id') || articles[0];
    }

    const outline = (activeArticle?.articlePlan?.outline as { title: string; level: number }[]) || [];

    return NextResponse.json({
      exists: true,
      project: {
        id: project.id,
        name: project.name,
        state: project.state,
        siteUrl: project.siteUrl,
        siteAudit: project.siteAudit ? {
          id: project.siteAudit.id,
          seoScore: project.siteAudit.seoScore,
          auditMatrix: project.siteAudit.auditMatrix,
          actionPlan: project.siteAudit.actionPlan,
        } : null,
        knowledgeBase: project.knowledgeBase ? {
          id: project.knowledgeBase.id,
          status: project.knowledgeBase.status,
          verifiedFacts: project.knowledgeBase.verifiedFacts,
          brandEntities: project.knowledgeBase.brandEntities,
          writingInstructions: project.knowledgeBase.writingInstructions,
          generatedChecklist: project.knowledgeBase.generatedChecklist,
          rules: project.knowledgeBase.rules,
          pillars: project.knowledgeBase.pillars,
          outboundLinks: project.knowledgeBase.outboundLinks,
        } : null,
        contentPlan: contentPlan ? {
          id: contentPlan.id,
          status: contentPlan.status,
          suggestedGaps: contentPlan.suggestedGaps
        } : null
      },
      sources: sources.map(s => ({
        id: s.id,
        type: s.type,
        url: s.url,
        identifier: s.identifier,
        displayName: s.displayName,
        status: s.status,
        errorMessage: s.errorMessage,
        extractedData: s.extractedData
      })),
      strategy: strategy ? {
        id: strategy.id,
        summary: strategy.summary,
        targetKeywords: strategy.targetKeywords,
        contentPillars: strategy.contentPillars,
        geoTargets: strategy.geoTargets,
        contentMix: strategy.contentMix,
        monthlyTarget: strategy.monthlyTarget,
        version: strategy.version
      } : null,
      articles: articles.map(a => ({
        id: a.id,
        title: a.title,
        state: a.state,
        wordCount: a.wordCount,
        outboundLinks: a.articlePlan?.outboundLinks.map((ol: any) => ({
          targetSlug: ol.targetPlan?.slug || ol.targetPlanId,
          anchorText: ol.anchorText
        })) || [],
        progress: a.articlePlan?.outline ? {
          completed: a.sections.length,
          total: (a.articlePlan.outline as any[]).length
        } : null
      })),
      activeArticle: activeArticle ? {
        id: activeArticle.id,
        title: activeArticle.title,
        state: activeArticle.state,
        wordCount: activeArticle.wordCount,
        htmlContent: activeArticle.htmlContent,
        articlePlan: activeArticle.articlePlan,
        qualityGate: activeArticle.qualityGate,
        faq: activeArticle.faq,
        schemaMarkup: activeArticle.schemaMarkup,
        wpInstructions: activeArticle.wpInstructions,
        versions: activeArticle.versions.map((v: any) => ({
          versionNumber: v.versionNumber,
          changeNote: v.changeNote,
          createdAt: v.createdAt
        })),
        sections: activeArticle.sections.map((s: any) => ({
          id: s.id,
          order: s.order,
          headingTitle: s.headingTitle,
          wordCount: s.wordCount,
          htmlContent: s.htmlContent
        })),
        progress: {
          completed: activeArticle.sections.length,
          total: outline.length,
          percentage: outline.length > 0 ? Math.round((activeArticle.sections.length / outline.length) * 100) : 0,
        }
      } : null,
      outline
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
