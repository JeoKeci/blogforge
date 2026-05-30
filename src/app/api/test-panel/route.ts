import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';
import { buildConstitution } from '@/lib/knowledge-base';

// POST /api/test-panel — seed database and/or trigger section generation
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ─── SEED: Reset and seed the test article ───
    if (action === 'seed') {
      const now = new Date();
      const userId = 'test-user-id';
      const projectId = 'test-project-id';
      const contentPlanId = 'test-content-plan-id';

      // Clean existing test data (reverse FK order)
      await prisma.articleSection.deleteMany();
      await prisma.articleVersion.deleteMany();
      await prisma.article.deleteMany();
      await prisma.articlePlan.deleteMany();
      await prisma.contentPlan.deleteMany();
      await prisma.strategyRevision.deleteMany();
      await prisma.strategy.deleteMany();
      await prisma.competitor.deleteMany();
      await prisma.siteAudit.deleteMany();
      await prisma.contentSource.deleteMany();
      await prisma.contentRule.deleteMany();
      await prisma.contentPillar.deleteMany();
      await prisma.outboundLink.deleteMany();
      await prisma.knowledgeBase.deleteMany();
      await prisma.project.deleteMany();
      await prisma.membership.deleteMany();
      await prisma.organization.deleteMany();
      await prisma.user.deleteMany();

      // Seed fresh data using atomic transaction
      await prisma.$transaction(async (tx) => {
        // 1. User
        await tx.user.create({
          data: { id: userId, email: 'test@example.com', name: 'Test User', createdAt: now, updatedAt: now },
        });

        // 2. Organization
        const orgId = 'test-org-id';
        await tx.organization.create({
          data: { id: orgId, name: 'Kişisel Organizasyon', createdAt: now, updatedAt: now },
        });

        // 3. Membership
        await tx.membership.create({
          data: { userId, organizationId: orgId, role: 'OWNER', createdAt: now },
        });

        // 4. Test Project
        await tx.project.create({
          data: { id: projectId, organizationId: orgId, name: 'Test Project', siteUrl: '', state: 'CREATED', createdAt: now, updatedAt: now },
        });
      });

      await prisma.contentPlan.create({
        data: { id: contentPlanId, projectId, createdAt: now },
      });

      return NextResponse.json({ success: true, message: 'Temel test verisi (boş içerik planı ile) başarıyla oluşturuldu.' });
    }

    // ─── TRIGGER: Dispatch the next section to Celery ───
    if (action === 'trigger_next') {
      const articleId = body.articleId || 'test-article-id';

      // Get the article with its plan and existing sections
      const article = await prisma.article.findUnique({
        where: { id: articleId },
        include: {
          articlePlan: true,
          sections: { orderBy: { order: 'asc' } },
        },
      });

      if (!article) {
        return NextResponse.json({ error: 'Test makalesi bulunamadı. Önce "Seed" yapın.' }, { status: 404 });
      }

      const outline = (article.articlePlan?.outline as { title: string; level: number }[]) || [];
      const completedCount = article.sections.length;

      if (completedCount >= outline.length) {
        return NextResponse.json({ error: 'Tüm bölümler zaten yazılmış!', completed: true }, { status: 400 });
      }

      const nextSection = outline[completedCount];
      const nextOrder = completedCount + 1;

      // Get previous section content for rolling context
      const previousContent = completedCount > 0
        ? article.sections[completedCount - 1].htmlContent
        : '';

      const constitution = await buildConstitution(article.projectId);
      if (!constitution) {
        return NextResponse.json({ error: 'KnowledgeBase onaylı değil; önce KB\'yi APPROVED yapın.' }, { status: 422 });
      }

      // Update article state to WRITING
      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'WRITING' },
      });

      // Dispatch to Celery via Redis
      const taskId = await sendCeleryTask('tasks.generate_section_iterative', [
        articleId,
        article.projectId,
        nextOrder,
        nextSection.title,
        previousContent,
        constitution.rulesText,
        nextSection.level || 2,
        constitution.language,
        constitution.tone,
      ]);

      return NextResponse.json({
        success: true,
        taskId,
        section: nextSection.title,
        order: nextOrder,
        totalSections: outline.length,
        message: `"${nextSection.title}" bölümü Celery'ye gönderildi.`,
      });
    }

    // ─── TRIGGER ALL: Dispatch all remaining sections sequentially ───
    if (action === 'trigger_all') {
      const articleId = body.articleId || 'test-article-id';

      const article = await prisma.article.findUnique({
        where: { id: articleId },
        include: {
          articlePlan: true,
          sections: { orderBy: { order: 'asc' } },
        },
      });

      if (!article) {
        return NextResponse.json({ error: 'Test makalesi bulunamadı. Önce "Seed" yapın.' }, { status: 404 });
      }

      const outline = (article.articlePlan?.outline as { title: string; level: number }[]) || [];
      const completedCount = article.sections.length;

      if (completedCount >= outline.length) {
        return NextResponse.json({ error: 'Tüm bölümler zaten yazılmış!', completed: true }, { status: 400 });
      }

      // We can only trigger the immediate next one via Celery since each depends on the previous
      // The remaining ones need to be triggered after each completion
      // For MVP, trigger next only (the UI will poll and auto-trigger remaining)
      const nextSection = outline[completedCount];
      const nextOrder = completedCount + 1;

      const previousContent = completedCount > 0
        ? article.sections[completedCount - 1].htmlContent
        : '';

      const constitution = await buildConstitution(article.projectId);
      if (!constitution) {
        return NextResponse.json({ error: 'KnowledgeBase onaylı değil; önce KB\'yi APPROVED yapın.' }, { status: 422 });
      }

      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'WRITING' },
      });

      const taskId = await sendCeleryTask('tasks.generate_section_iterative', [
        articleId,
        article.projectId,
        nextOrder,
        nextSection.title,
        previousContent,
        constitution.rulesText,
        nextSection.level || 2,
        constitution.language,
        constitution.tone,
      ]);

      return NextResponse.json({
        success: true,
        taskId,
        section: nextSection.title,
        order: nextOrder,
        totalSections: outline.length,
        autoMode: true,
        message: `Otomatik mod: "${nextSection.title}" bölümü gönderildi. Kalan bölümler otomatik tetiklenecek.`,
      });
    }

    return NextResponse.json({ error: 'Bilinmeyen aksiyon.' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test panel API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
