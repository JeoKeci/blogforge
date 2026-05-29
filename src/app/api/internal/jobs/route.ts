import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const secretToken = process.env.INTERNAL_SECRET_TOKEN;
    
    // Faz 1 Güvenlik Kalkanı: Bearer Token kontrolü
    if (!authHeader || authHeader !== `Bearer ${secretToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { action, articleId, projectId, order, headingTitle, htmlContent, wordCount } = body;
    
    if (action === 'section_complete') {
      // 1. Bölümü veri tabanına yaz (Checkpoint)
      await prisma.articleSection.upsert({
        where: {
          articleId_order: {
            articleId,
            order
          }
        },
        update: {
          htmlContent,
          markdownContent: '', // MVP'de boş bırakılabilir veya HTML'den dönüştürülebilir
          wordCount
        },
        create: {
          articleId,
          order,
          headingTitle,
          headingLevel: 2, // Default H2
          htmlContent,
          markdownContent: '',
          wordCount
        }
      });
      
      // 2. Makalenin genel durumunu ve HTML birleşimini güncelle
      const sections = await prisma.articleSection.findMany({
        where: { articleId },
        orderBy: { order: 'asc' }
      });
      
      const mergedHtml = sections.map(s => `<h2>${s.headingTitle}</h2>\n${s.htmlContent}`).join('\n\n');
      const totalWordCount = sections.reduce((acc, curr) => acc + curr.wordCount, 0);
      
      // 3. Bölüm sayısını taslaktaki (outline) H2/H3 sayısıyla karşılaştır
      const articleWithPlan = await prisma.article.findUnique({
        where: { id: articleId },
        include: { articlePlan: true }
      });
      
      const outlineLength = (articleWithPlan?.articlePlan?.outline as any[])?.length || 0;
      const isComplete = sections.length === outlineLength;
      
      await prisma.article.update({
        where: { id: articleId },
        data: {
          htmlContent: mergedHtml,
          wordCount: totalWordCount,
          state: isComplete ? 'PREVIEW_READY' : 'WRITING'
        }
      });
      
      return NextResponse.json({ success: true });
    }
    
    if (action === 'constitution_complete') {
      const { projectId, siteAuditId, constitution: constitutionStr } = body;
      const data = JSON.parse(constitutionStr);

      // Veritabanı yazım işlemlerini atomik transaction altında yürüt
      await prisma.$transaction(async (tx) => {
        // 1. Varsa eski KnowledgeBase ve alt kurallarını tamamen temizle (Idempotency)
        const existingKb = await tx.knowledgeBase.findUnique({ where: { projectId } });
        if (existingKb) {
          await tx.contentRule.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.contentPillar.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.outboundLink.deleteMany({ where: { knowledgeBaseId: existingKb.id } });
          await tx.knowledgeBase.delete({ where: { projectId } });
        }

        // 2. Ana KnowledgeBase kaydını oluştur (DRAFT durumunda)
        const kb = await tx.knowledgeBase.create({
          data: {
            projectId,
            verifiedFacts: data.verified_facts,
            brandEntities: data.brand_entities,
            writingInstructions: data.writing_instructions,
            generatedChecklist: data.generated_checklist,
            status: 'DRAFT', // İnsan onayı bekliyor
          }
        });

        // 3. Alt kuralları (ContentRule) ilişkisel olarak doldur
        if (data.rules && data.rules.length > 0) {
          await tx.contentRule.createMany({
            data: data.rules.map((r: any) => ({
              knowledgeBaseId: kb.id,
              type: r.type, // FORBIDDEN_PHRASE, FACT_CORRECTION, REQUIRED, STYLE
              value: r.value,
              reason: r.reason,
              evidence: r.source_url ? { sourceUrl: r.source_url } : {},
              origin: 'AI_DERIVED'
            }))
          });
        }

        // 4. İçerik silolarını (ContentPillar) kaydet
        if (data.pillars && data.pillars.length > 0) {
          await tx.contentPillar.createMany({
            data: data.pillars.map((p: any) => ({
              knowledgeBaseId: kb.id,
              name: p.name,
              scope: p.scope
            }))
          });
        }

        // 5. Güvenilir dış linkleri (OutboundLink) kaydet
        if (data.outbound_links && data.outbound_links.length > 0) {
          await tx.outboundLink.createMany({
            data: data.outbound_links.map((ol: any) => ({
              knowledgeBaseId: kb.id,
              url: ol.url,
              title: ol.title,
              usageArea: ol.usage_area
            }))
          });
        }

        // 6. Projenin durumunu SOURCES_ANALYZED aşamasına yükselt
        await tx.project.update({
          where: { id: projectId },
          data: { state: 'SOURCES_ANALYZED' }
        });
      });

      return NextResponse.json({ success: true, message: 'KnowledgeBase successfully generated in DRAFT state.' });
    }
    
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
