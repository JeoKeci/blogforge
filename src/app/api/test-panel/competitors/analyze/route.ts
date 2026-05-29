import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';

const TEST_PROJECT_ID = 'test-project-id';

export async function POST() {
  try {
    // Start Competitor Analysis
    await sendCeleryTask('tasks.analyze_competitors', [TEST_PROJECT_ID]);
    
    // In a real scenario, gap analysis might be chained in Celery (e.g. celery.chain) or webhook.
    // For MVP, we can trigger gap analysis with a slight delay or directly pass mock keywords.
    // Let's pass the mock competitor keywords directly to run_gap_analysis for immediate processing.
    
    const project = await prisma.project.findUnique({
      where: { id: TEST_PROJECT_ID },
      include: {
        contentPlan: {
          include: { articles: true }
        }
      }
    });
    
    const existingKeywords = project?.contentPlan?.articles.map(a => a.focusKeyword).filter(Boolean) || [];
    const competitorKeywordsStr = "merbau durability class, hardwood supplier europe, buy bilinga wood, azobe sheet piling, wholesale tropical timber, meranti decking";
    const existingKeywordsStr = existingKeywords.join(", ");
    
    await sendCeleryTask('tasks.run_gap_analysis', [TEST_PROJECT_ID, competitorKeywordsStr, existingKeywordsStr]);
    
    return NextResponse.json({ success: true, message: 'Competitor and Gap Analysis tasks triggered' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
