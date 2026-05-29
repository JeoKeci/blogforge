import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';
import { buildConstitution } from '@/lib/knowledge-base';

export async function POST(request: Request) {
  try {
    const { articleId, sectionId, feedback } = await request.json();

    if (!articleId || !sectionId || !feedback) {
      return NextResponse.json({ error: 'Missing articleId, sectionId, or feedback' }, { status: 400 });
    }

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: {
        sections: true,
        project: {
          include: { knowledgeBase: true }
        }
      }
    });

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const section = article.sections.find(s => s.id === sectionId);
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });
    }

    // Shield #9: Lock the article
    await prisma.article.update({
      where: { id: articleId },
      data: { state: 'WRITING' }
    });

    const contextStr = article.sections
      .filter(s => s.order < section.order)
      .map(s => `## ${s.headingTitle}\n${s.htmlContent}`)
      .join('\n\n');

    const constitution = await buildConstitution(article.projectId);
    if (!constitution) {
      return NextResponse.json({ error: 'KnowledgeBase onaylı değil; önce KB\'yi APPROVED yapın.' }, { status: 422 });
    }

    // Trigger Celery Task
    await sendCeleryTask('tasks.generate_section_iterative', [
      article.id,
      article.projectId,
      section.order,
      section.headingTitle,
      contextStr,
      constitution.rulesText,
      section.headingLevel || 2,
      constitution.language,
      constitution.tone,
      feedback
    ]);

    return NextResponse.json({ success: true, message: 'Rewrite task triggered successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
