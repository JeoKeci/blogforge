import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  try {
    const { gap } = await request.json();

    const project = await prisma.project.findUnique({
      where: { id: 'test-project-id' },
      include: { contentPlan: { include: { articles: true } } }
    });

    if (!project || !project.contentPlan) {
      return NextResponse.json({ error: 'Content plan not found' }, { status: 404 });
    }

    const newOrder = (project.contentPlan.articles?.length || 0) + 1;
    const slug = gap.focusKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const newPlan = await prisma.articlePlan.create({
      data: {
        contentPlanId: project.contentPlan.id,
        projectId: project.id,
        order: newOrder,
        title: gap.title,
        focusKeyword: gap.focusKeyword,
        slug: slug,
        contentType: gap.type === 'new_article' ? 'guide' : 'how-to',
        outline: [
          { title: `${gap.focusKeyword} Nedir?`, level: 2 },
          { title: `Avantajları ve Kullanım Alanları`, level: 2 }
        ], // Mock outline
        status: 'planned'
      }
    });

    // Optionally remove the gap from suggestedGaps
    const currentGaps = project.contentPlan.suggestedGaps as any[] || [];
    const updatedGaps = currentGaps.filter(g => g.focusKeyword !== gap.focusKeyword);

    await prisma.contentPlan.update({
      where: { id: project.contentPlan.id },
      data: { suggestedGaps: updatedGaps }
    });

    return NextResponse.json({ success: true, articlePlan: newPlan });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
