import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { generateUnifiedStrategy } from '@/lib/pipeline/strategy-planner';

const TEST_PROJECT_ID = 'test-project-id';

export async function POST() {
  try {
    // Invoke joint planner to generate strategy & content plan
    const strategyResult = await generateUnifiedStrategy(TEST_PROJECT_ID);

    // Update project state to STRATEGY_REVIEW or PLAN_READY
    await prisma.project.update({
      where: { id: TEST_PROJECT_ID },
      data: { state: 'STRATEGY_REVIEW' } // Based on user instruction
    });

    return NextResponse.json({
      success: true,
      message: 'Strateji başarıyla üretildi.',
      strategy: strategyResult.strategy,
      contentPlan: strategyResult.contentPlan,
      articles: strategyResult.articles
    });
  } catch (error: any) {
    console.error('Generate strategy error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
