import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

// GET /api/test-panel/status — poll article state and sections
export async function GET() {
  try {
    const articleId = 'test-article-id';

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: {
        articlePlan: true,
        sections: { orderBy: { order: 'asc' } },
      },
    });

    if (!article) {
      return NextResponse.json({
        exists: false,
        message: 'Test makalesi bulunamadı. "Seed & Reset" butonuna tıklayın.',
      });
    }

    const outline = (article.articlePlan?.outline as { title: string; level: number }[]) || [];

    return NextResponse.json({
      exists: true,
      article: {
        id: article.id,
        title: article.title,
        state: article.state,
        wordCount: article.wordCount,
        htmlContent: article.htmlContent,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
      outline,
      sections: article.sections.map((s) => ({
        id: s.id,
        order: s.order,
        headingTitle: s.headingTitle,
        wordCount: s.wordCount,
        htmlContent: s.htmlContent,
        createdAt: s.createdAt,
      })),
      progress: {
        completed: article.sections.length,
        total: outline.length,
        percentage: outline.length > 0 ? Math.round((article.sections.length / outline.length) * 100) : 0,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
