import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { sendCeleryTask } from '@/lib/celery';

export async function POST(request: Request) {
  try {
    const { articleId } = await request.json();

    if (!articleId) {
      return NextResponse.json({ error: 'Article ID required' }, { status: 400 });
    }

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      include: {
        project: {
          include: {
            organization: {
              include: {
                cmsConnections: true
              }
            }
          }
        }
      }
    });

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    if (article.state !== 'PREVIEW_READY') {
      return NextResponse.json({ error: 'Article is not in PREVIEW_READY state' }, { status: 400 });
    }

    // Prepare WP Payload
    const wpInstructions = article.wpInstructions as any;
    const faq = article.faq as any;
    
    // Simplistic HTML compilation for WP
    let fullHtml = article.htmlContent || '';
    if (faq && Array.isArray(faq) && faq.length > 0) {
      fullHtml += '\n\n<h2>Sıkça Sorulan Sorular</h2>\n';
      faq.forEach(f => {
        fullHtml += `<h3>${f.question}</h3>\n<p>${f.answer}</p>\n`;
      });
    }

    const wpPayload = {
      title: wpInstructions?.meta_title || article.title,
      content: fullHtml,
      status: 'draft',
      slug: wpInstructions?.wp_slug || article.slug,
    };

    // Find WP Connection
    const wpConnection = article.project.organization.cmsConnections.find(c => c.type === 'wordpress');
    
    // In mock mode, we don't strictly need a valid connection, but let's pass a dummy one if not found
    const connectionConfig = wpConnection ? {
      url: wpConnection.siteUrl,
      credentials: wpConnection.credentials
    } : {
      url: 'https://mock.wordpress.com',
      credentials: 'mock_user:mock_pass'
    };

    await prisma.article.update({
      where: { id: articleId },
      data: { state: 'PUBLISHING' }
    });

    // Publish directly from Next.js
    const { publishToWordPress } = await import('@/lib/wordpress');
    const publishResult = await publishToWordPress({
      siteUrl: connectionConfig.url,
      credentials: connectionConfig.credentials,
      payload: wpPayload
    });

    if (!publishResult.mocked && publishResult.id) {
      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'PUBLISHED', publishedAt: new Date(), cmsPostId: String(publishResult.id), cmsPostUrl: publishResult.url }
      });
    } else if (publishResult.mocked) {
      await prisma.article.update({
        where: { id: articleId },
        data: { state: 'PUBLISHED', publishedAt: new Date() }
      });
    }

    return NextResponse.json({ success: true, message: 'WordPress publish complete.', url: publishResult.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
