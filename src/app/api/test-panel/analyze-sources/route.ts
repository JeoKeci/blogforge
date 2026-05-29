import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { 
  analyzeWebsite, 
  analyzeYouTube, 
  analyzeInstagram, 
  analyzeCustom 
} from '@/lib/pipeline/source-analyzers';
import { sendCeleryTask } from '@/lib/celery';
const TEST_PROJECT_ID = 'test-project-id';

// POST /api/test-panel/analyze-sources — Run analysis on all pending sources & generate unified plan
export async function POST() {
  try {
    // 1. Set project state to SOURCES_ANALYZING
    await prisma.project.update({
      where: { id: TEST_PROJECT_ID },
      data: { state: 'SOURCES_ANALYZING' }
    });

    // 2. Fetch all sources for the test project
    const sources = await prisma.contentSource.findMany({
      where: { projectId: TEST_PROJECT_ID }
    });

    if (sources.length === 0) {
      // Revert project state
      await prisma.project.update({
        where: { id: TEST_PROJECT_ID },
        data: { state: 'CREATED' }
      });
      return NextResponse.json({ 
        success: false, 
        error: 'Analiz edilecek hiç kaynak bulunamadı. Lütfen önce kaynak ekleyin.' 
      }, { status: 400 });
    }

    const analysisSummary: Array<{ id: string; name: string; type: string; status: string; error?: string }> = [];

    // 3. Process each source sequentially
    for (const source of sources) {
      // Only analyze if PENDING or FAILED (skip already ANALYZED to save time/tokens)
      if (source.status === 'ANALYZED') {
        analysisSummary.push({
          id: source.id,
          name: source.displayName,
          type: source.type,
          status: 'SKIPPED_ALREADY_ANALYZED'
        });
        continue;
      }

      await prisma.contentSource.update({
        where: { id: source.id },
        data: { status: 'FETCHING', errorMessage: null }
      });

      try {
        let result: any = null;

        if (source.type === 'WEBSITE') {
          if (!source.url) throw new Error('Web sitesi için URL gerekli.');
          result = await analyzeWebsite(source.url);
        } else if (source.type === 'YOUTUBE') {
          // YouTube can use identifier (@handle) or url
          const input = source.identifier || source.url;
          if (!input) throw new Error('YouTube için kanal adı veya URL gerekli.');
          result = await analyzeYouTube(input);
        } else if (source.type === 'INSTAGRAM') {
          const username = source.identifier || 'instagram_profile';
          const pastedText = (source.extractedData as any)?.textContent || '';
          result = await analyzeInstagram(username, pastedText);
        } else if (source.type === 'CUSTOM') {
          const docName = source.displayName || 'Özel Rehber';
          const pastedText = (source.extractedData as any)?.textContent || '';
          if (!pastedText) throw new Error('Özel doküman içeriği boş olamaz.');
          result = await analyzeCustom(docName, pastedText);
        } else {
          throw new Error(`Bilinmeyen kaynak türü: ${source.type}`);
        }

        // Save extracted raw data (Status stays FETCHING or EXTRACTED until LLM is done)
        const currentData = typeof source.extractedData === 'object' ? (source.extractedData as any) || {} : {};
        const mergedData = { ...currentData, ...result };

        await prisma.contentSource.update({
          where: { id: source.id },
          data: {
            status: 'FETCHING', // still fetching/analyzing via celery
            extractedData: mergedData
          }
        });

        analysisSummary.push({
          id: source.id,
          name: source.displayName,
          type: source.type,
          status: 'SENT_TO_CELERY'
        });

      } catch (err: any) {
        console.error(`Error analyzing source ${source.id}:`, err.message);
        
        await prisma.contentSource.update({
          where: { id: source.id },
          data: {
            status: 'FAILED',
            errorMessage: err.message
          }
        });

        analysisSummary.push({
          id: source.id,
          name: source.displayName,
          type: source.type,
          status: 'FAILED',
          error: err.message
        });
      }
    }

    // 4. Check if we have at least one successfully analyzed source to build a strategy
    const activeAnalyzedSources = await prisma.contentSource.findMany({
      where: { projectId: TEST_PROJECT_ID, status: 'ANALYZED' }
    });

    if (activeAnalyzedSources.length === 0) {
      await prisma.project.update({
        where: { id: TEST_PROJECT_ID },
        data: { state: 'CREATED' }
      });
      return NextResponse.json({
        success: false,
        error: 'Hiçbir dijital kaynak başarıyla analiz edilemedi. Lütfen hata alan kaynakları kontrol edin.',
        analysisSummary
      }, { status: 422 });
    }

    // 5. Retrieve the SiteAudit to pass raw data to Celery
    const siteAudit = await prisma.siteAudit.findUnique({
      where: { projectId: TEST_PROJECT_ID }
    });

    if (!siteAudit) {
      throw new Error('SiteAudit kaydı bulunamadı. Kural Anayasası türetilemez.');
    }

    const rawAuditDataStr = JSON.stringify(siteAudit.rawData || {});

    // 6. Trigger Celery Task to derive the Constitution
    const taskId = await sendCeleryTask('tasks.derive_constitution', [
      TEST_PROJECT_ID,
      siteAudit.id,
      rawAuditDataStr
    ]);

    return NextResponse.json({
      success: true,
      message: 'Kaynaklar analiz edildi ve Kural Anayasası (Constitution) türetimi Celery\'ye gönderildi.',
      taskId,
      analysisSummary
    });

  } catch (error: any) {
    console.error('Analyze sources error:', error.message);
    
    // Revert state on unexpected failure
    try {
      await prisma.project.update({
        where: { id: TEST_PROJECT_ID },
        data: { state: 'CREATED' }
      });
    } catch {}

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
