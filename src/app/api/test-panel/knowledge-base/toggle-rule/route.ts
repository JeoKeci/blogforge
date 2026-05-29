import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ruleId, isActive } = body;

    if (!ruleId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'ruleId and isActive are required' }, { status: 400 });
    }

    await prisma.contentRule.update({
      where: { id: ruleId },
      data: { isActive }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
