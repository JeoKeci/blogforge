import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';

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
      const articlePlanId = 'test-article-plan-id';
      const articleId = 'test-article-id';

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
          data: { id: projectId, organizationId: orgId, name: 'Test Project', siteUrl: 'https://example.com', state: 'CREATED', createdAt: now, updatedAt: now },
        });

        // 5. Default Sources
        await tx.contentSource.create({
          data: { projectId, type: 'WEBSITE', url: 'https://geocenter.com', displayName: 'GeoCenter Blog', status: 'PENDING' }
        });
        await tx.contentSource.create({
          data: { projectId, type: 'YOUTUBE', identifier: '@GeocKece', displayName: '@GeocKece Kanalı', status: 'PENDING' }
        });
      });

      await prisma.contentPlan.create({
        data: { id: contentPlanId, projectId, createdAt: now },
      });

      const outline = [
        { title: '1. Giriş', level: 2 },
        { title: '2. SEO Uyumlu Makale Nasıl Yazılır?', level: 2 },
        { title: '3. Sonuç', level: 2 },
      ];

      await prisma.articlePlan.create({
        data: {
          id: articlePlanId,
          contentPlanId,
          order: 1,
          title: 'SEO Uyumlu Makale Yazım Kılavuzu',
          primaryKeyword: 'seo uyumlu makale',
          secondaryKeywords: '[]',
          searchIntent: 'informational',
          contentType: 'guide',
          targetWordCount: 1000,
          priority: 'high',
          geoTarget: 'TR',
          outline,
          status: 'planned',
          createdAt: now,
        },
      });

      await prisma.article.create({
        data: {
          id: articleId,
          projectId,
          articlePlanId,
          title: 'SEO Uyumlu Makale Yazım Kılavuzu',
          slug: 'seo-uyumlu-makale-yazim-kilavuzu',
          metaDescription: 'SEO uyumlu makale yazımı hakkında detaylı kılavuz.',
          htmlContent: '',
          markdownContent: '',
          focusKeyword: 'seo uyumlu makale',
          wordCount: 0,
          state: 'OUTLINE_APPROVED',
          currentVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      });

      return NextResponse.json({ success: true, message: 'Test verisi başarıyla oluşturuldu.' });
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

      // Build static rules based on section position
      let staticRules = 'Dil Türkçe olmalı. Zengin HTML (p, strong, ul, li) kullanılmalı.';
      if (nextOrder === 1) {
        staticRules += ' Makale giriş bölümü olduğu için konuya hızlı ve çarpıcı bir giriş yapmalı.';
      } else if (nextOrder === outline.length) {
        staticRules += ' Makale sonuç bölümü olduğu için konuyu toparlayıp okuyucuyu harekete geçiren güçlü bir kapanış yapmalı.';
      } else {
        staticRules += ' Makale ana bölümü olduğu için pratik SEO tekniklerini anlatmalı.';
      }

      // Update article state to WRITING
      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'WRITING' },
      });

      // Dispatch to Celery via Redis
      const taskId = await sendCeleryTask('tasks.generate_section_iterative', [
        articleId,
        'test-project-id',
        nextOrder,
        nextSection.title,
        previousContent,
        staticRules,
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

      let staticRules = 'Dil Türkçe olmalı. Zengin HTML (p, strong, ul, li) kullanılmalı.';
      if (nextOrder === 1) {
        staticRules += ' Makale giriş bölümü olduğu için konuya hızlı ve çarpıcı bir giriş yapmalı.';
      } else if (nextOrder === outline.length) {
        staticRules += ' Makale sonuç bölümü olduğu için konuyu toparlayıp okuyucuyu harekete geçiren güçlü bir kapanış yapmalı.';
      } else {
        staticRules += ' Makale ana bölümü olduğu için pratik SEO tekniklerini anlatmalı.';
      }

      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'WRITING' },
      });

      const taskId = await sendCeleryTask('tasks.generate_section_iterative', [
        articleId,
        'test-project-id',
        nextOrder,
        nextSection.title,
        previousContent,
        staticRules,
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
