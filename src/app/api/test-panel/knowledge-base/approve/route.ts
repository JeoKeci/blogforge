import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

const TEST_PROJECT_ID = 'test-project-id';

export async function POST() {
  try {
    await prisma.$transaction(async (tx) => {
      // Find the KnowledgeBase for the test project
      const kb = await tx.knowledgeBase.findUnique({
        where: { projectId: TEST_PROJECT_ID }
      });

      if (!kb) {
        throw new Error('Onaylanacak Knowledge Base bulunamadı.');
      }

      // Update KB status to APPROVED
      await tx.knowledgeBase.update({
        where: { id: kb.id },
        data: { 
          status: 'APPROVED',
          approvedAt: new Date()
        }
      });

      // Keep project state as SOURCES_ANALYZED or transition appropriately.
      // Based on user instructions, state can stay SOURCES_ANALYZED, but we ensure it's set.
      await tx.project.update({
        where: { id: TEST_PROJECT_ID },
        data: { state: 'SOURCES_ANALYZED' }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
