import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { 
  analyzeWebsite, 
  analyzeYouTube, 
  analyzeInstagram, 
  analyzeCustom 
} from '@/lib/pipeline/source-analyzers';
import { generateUnifiedStrategy } from '@/lib/pipeline/strategy-planner';

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

        // Save successfully analyzed data
        // Merge with existing JSON to preserve pasted inputs if needed
        const currentData = typeof source.extractedData === 'object' ? (source.extractedData as any) || {} : {};
        const mergedData = { ...currentData, ...result };

        await prisma.contentSource.update({
          where: { id: source.id },
          data: {
            status: 'ANALYZED',
            extractedData: mergedData
          }
        });

        // Persist audit data to SiteAudit model for WEBSITE sources
        if (source.type === 'WEBSITE' && result?.audit) {
          const domain = new URL(source.url || '').hostname.replace(/^www\./, '');
          await prisma.siteAudit.upsert({
            where: { projectId: TEST_PROJECT_ID },
            update: {
              domain,
              brandInfo: {
                industry: result.industry || '',
                targetAudience: result.targetAudience || '',
                toneOfVoice: result.toneOfVoice || '',
                detectedArchetype: result.detectedArchetype || '',
                detectedKeywords: result.detectedKeywords || [],
              },
              auditMatrix: result.audit,
              actionPlan: result.actionPlan || [],
              rawData: mergedData,
              seoScore: result.audit?.totalScore ?? null,
            },
            create: {
              projectId: TEST_PROJECT_ID,
              domain,
              brandInfo: {
                industry: result.industry || '',
                targetAudience: result.targetAudience || '',
                toneOfVoice: result.toneOfVoice || '',
                detectedArchetype: result.detectedArchetype || '',
                detectedKeywords: result.detectedKeywords || [],
              },
              auditMatrix: result.audit,
              actionPlan: result.actionPlan || [],
              rawData: mergedData,
              seoScore: result.audit?.totalScore ?? null,
              existingPages: [],
              existingKeywords: [],
            }
          });
        }

        analysisSummary.push({
          id: source.id,
          name: source.displayName,
          type: source.type,
          status: 'ANALYZED'
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

    // 5. Invoke joint planner to generate strategy & content plan
    const strategyResult = await generateUnifiedStrategy(TEST_PROJECT_ID);

    return NextResponse.json({
      success: true,
      message: 'Kaynaklar analiz edildi ve birleşik plan oluşturuldu.',
      analysisSummary,
      strategy: strategyResult.strategy,
      contentPlan: strategyResult.contentPlan,
      articles: strategyResult.articles
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
