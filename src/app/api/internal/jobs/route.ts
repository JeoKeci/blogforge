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
    
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
