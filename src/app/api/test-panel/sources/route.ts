import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

const TEST_PROJECT_ID = 'test-project-id';

// GET /api/test-panel/sources — List all sources for the test project
export async function GET() {
  try {
    const sources = await prisma.contentSource.findMany({
      where: { projectId: TEST_PROJECT_ID },
      orderBy: { createdAt: 'desc' }
    });
    
    return NextResponse.json({ success: true, sources });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/test-panel/sources — Add a new source to the test project
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, url, identifier, displayName, textContent } = body;

    if (!type || !['WEBSITE', 'YOUTUBE', 'INSTAGRAM', 'CUSTOM'].includes(type)) {
      return NextResponse.json({ success: false, error: 'Geçersiz kaynak tipi.' }, { status: 400 });
    }

    let finalDisplayName = displayName || '';
    if (!finalDisplayName) {
      if (type === 'WEBSITE') finalDisplayName = url || 'Web Sitesi';
      else if (type === 'YOUTUBE') finalDisplayName = identifier || url || 'YouTube Kanalı';
      else if (type === 'INSTAGRAM') finalDisplayName = identifier || 'Instagram Sayfası';
      else finalDisplayName = 'Özel Kaynak';
    }

    // Prepare extractedData if custom text is provided
    let extractedData = null;
    if (type === 'CUSTOM' && textContent) {
      extractedData = { textContent };
    } else if (type === 'INSTAGRAM' && textContent) {
      extractedData = { textContent }; // Keep pasted bio/posts here
    }

    const source = await prisma.contentSource.create({
      data: {
        projectId: TEST_PROJECT_ID,
        type,
        url: url || null,
        identifier: identifier || null,
        displayName: finalDisplayName,
        status: 'PENDING',
        extractedData: extractedData ? (extractedData as any) : undefined
      }
    });

    return NextResponse.json({ success: true, source });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/test-panel/sources — Delete a source
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Kaynak ID\'si gerekli.' }, { status: 400 });
    }

    await prisma.contentSource.deleteMany({
      where: { id }
    });

    return NextResponse.json({ success: true, message: 'Kaynak başarıyla silindi.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
