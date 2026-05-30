import { prisma } from './db/prisma';

export interface Constitution {
  language: string;
  tone: string;
  minWords: number;
  rulesText: string;            // generate_section_iterative'e static_rules olarak geçilecek
  rulesForGate: { type: string; value: string; reason?: string | null }[];
  verifiedFacts: unknown;
}

/** Onaylı (APPROVED) KnowledgeBase'i derler. APPROVED değilse null döner. */
export async function buildConstitution(projectId: string): Promise<Constitution | null> {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { projectId },
    include: { rules: { where: { isActive: true } }, outboundLinks: true, pillars: true },
  });
  if (!kb || kb.status !== 'APPROVED') return null;

  let wi: any = {};
  if (Array.isArray(kb.writingInstructions)) {
    (kb.writingInstructions as any[]).forEach(item => {
      if (item.key && item.value) wi[item.key] = item.value;
    });
  } else {
    wi = (kb.writingInstructions as any) || {};
  }
  const language = wi.language || 'tr';
  const tone = wi.tone || '';
  const minWords = Number(wi.minWords) || 1500;

  const pick = (t: string) => kb.rules.filter(r => r.type === t).map(r => r.value);
  const corrections = kb.rules
    .filter(r => r.type === 'FACT_CORRECTION')
    .map(r => `${r.value}${r.reason ? ' — ' + r.reason : ''}`);

  const lines: string[] = [];
  lines.push(`DİL: Tüm metni KESİNLİKLE şu dilde yaz: ${language}`);
  lines.push(`MINIMUM KELİME SAYISI: ${minWords}`);
  if (tone) lines.push(`TON: ${tone}`);
  if (corrections.length) lines.push(`DOĞRULANMIŞ GERÇEKLER / ZORUNLU DÜZELTMELER:\n- ${corrections.join('\n- ')}`);
  if (pick('FORBIDDEN_PHRASE').length) lines.push(`YASAK İFADELER (asla kullanma):\n- ${pick('FORBIDDEN_PHRASE').join('\n- ')}`);
  if (pick('REQUIRED').length) lines.push(`ZORUNLULUKLAR:\n- ${pick('REQUIRED').join('\n- ')}`);
  if (pick('STYLE').length) lines.push(`ÜSLUP:\n- ${pick('STYLE').join('\n- ')}`);
  if (kb.verifiedFacts) lines.push(`TEKNİK VERİLER (JSON):\n${JSON.stringify(kb.verifiedFacts)}`);
  if (kb.outboundLinks.length)
    lines.push(`GÜVENİLİR DIŞ LİNKLER:\n${kb.outboundLinks.map(l => `- ${l.url} (${l.title})${l.usageArea ? ' — ' + l.usageArea : ''}`).join('\n')}`);

  return {
    language,
    tone,
    minWords,
    rulesText: lines.join('\n\n'),
    rulesForGate: kb.rules.map(r => ({ type: r.type, value: r.value, reason: r.reason })),
    verifiedFacts: kb.verifiedFacts,
  };
}
