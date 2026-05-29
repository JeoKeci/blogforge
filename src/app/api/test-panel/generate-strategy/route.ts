import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';

const TEST_PROJECT_ID = 'test-project-id';

export async function POST() {
  try {
    const project = await prisma.project.findUnique({
      where: { id: TEST_PROJECT_ID },
      include: {
        knowledgeBase: true,
        siteAudit: true
      }
    });

    if (!project || !project.knowledgeBase || !project.siteAudit) {
      return NextResponse.json({ success: false, error: 'KnowledgeBase or SiteAudit not found' }, { status: 400 });
    }

    const kbStr = JSON.stringify({
      verifiedFacts: project.knowledgeBase.verifiedFacts,
      writingInstructions: project.knowledgeBase.writingInstructions,
      brandEntities: project.knowledgeBase.brandEntities,
      // Pass rules if needed, but we'll just pass the whole DB object to be safe
      knowledgeBase: project.knowledgeBase
    });

    const auditStr = JSON.stringify(project.siteAudit.rawData || {});

    // Update project state to STRATEGY_GENERATING
    await prisma.project.update({
      where: { id: TEST_PROJECT_ID },
      data: { state: 'STRATEGY_GENERATING' }
    });

    await sendCeleryTask('tasks.generate_strategy', [TEST_PROJECT_ID, kbStr, auditStr]);

    return NextResponse.json({
      success: true,
      message: 'Strateji üretimi başarıyla başlatıldı.'
    });
  } catch (error: any) {
    console.error('Generate strategy error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
