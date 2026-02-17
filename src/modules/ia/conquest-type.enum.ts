export const CONQUEST_TYPES = [
  'Corpo',
  'Mente',
  'Familia',
  'Trabalho',
  'Social',
  'Financeiro',
  'Espiritual',
  'Hobby_Lazer',
] as const;

export type ConquestType = typeof CONQUEST_TYPES[number];

export function normalizeConquestType(input?: string): ConquestType | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // exact matches
  for (const v of CONQUEST_TYPES) {
    if (v.toLowerCase() === s) return v as ConquestType;
  }

  // fuzzy/inclusive matches -> retornam valores compatíveis com Prisma enum
  if (s.includes('corpo')) return 'Corpo';
  if (s.includes('ment') || /^(estud|ler|aprender)/.test(s)) return 'Mente';
  if (s.includes('fam') || s.includes('famil')) return 'Familia';
  if (s.includes('trabal') || s.includes('projet') || s.includes('taref')) return 'Trabalho';
  if (s.includes('social')) return 'Social';
  if (s.includes('financ') || s.includes('dinheir') || s.includes('econom')) return 'Financeiro';
  if (s.includes('espiritu') || s.includes('oração') || s.includes('medita')) return 'Espiritual';
  if (s.includes('hobby') || s.includes('lazer')) return 'Hobby_Lazer';

  return null;
}

export default CONQUEST_TYPES;

export function inferConquestTypeWithConfidence(input?: string): { type: ConquestType | null; confidence: number } {
  if (!input || typeof input !== 'string') return { type: null, confidence: 0 };
  const exact = normalizeConquestType(input);
  if (exact) return { type: exact, confidence: 0.95 };
  const s = (input || '').toLowerCase();
  // simple heuristics to assign lower confidence
  if (s.includes('corpo')) return { type: 'Corpo', confidence: 0.7 };
  if (s.includes('ment') || /^(estud|ler|aprender)/.test(s)) return { type: 'Mente', confidence: 0.7 };
  if (s.includes('fam') || s.includes('famil')) return { type: 'Familia', confidence: 0.7 };
  if (s.includes('trabal') || s.includes('projet') || s.includes('taref')) return { type: 'Trabalho', confidence: 0.7 };
  if (s.includes('social')) return { type: 'Social', confidence: 0.7 };
  if (s.includes('financ') || s.includes('dinheir') || s.includes('econom')) return { type: 'Financeiro', confidence: 0.7 };
  if (s.includes('espiritu') || s.includes('oração') || s.includes('medita')) return { type: 'Espiritual', confidence: 0.7 };
  if (s.includes('hobby') || s.includes('lazer')) return { type: 'Hobby_Lazer', confidence: 0.7 };
  return { type: null, confidence: 0 };
}
