const MAX_CHARS = 360;

const PORTUGUESE_MARK =
  /[áàâãéêíóôõúç]/i;
const PORTUGUESE_WORDS =
  /\b(de|que|para|com|uma|não|nao|você|voce|hoje|seu|sua|das|dos|pelo|pela|um|em|do|da|no|na|os|as|já|ja|ainda|dia|meta|metas|cuidado|jardim)\b/gi;
const ENGLISH_WORDS =
  /\b(the|and|your|today|with|this|that|you|are|is|to|of|for|goal)\b/gi;

const REPORT_WORDS =
  /\b(colhid[ao]s?|jardim|meta|metas|rega|regar|semente|plantou|floresce|florescendo)\b/i;

export function soundsLikeReport(text: string, forbidden: string[]): boolean {
  if (REPORT_WORDS.test(text)) return true;
  if (/\b(não foi|nao foi|foi feita|foi feito|em aberto|ainda não foi|ainda nao foi)\b/i.test(text)) {
    return true;
  }
  const lower = text.toLowerCase();
  return forbidden.some((word) => {
    const needle = word.trim().toLowerCase();
    return needle.length >= 3 && lower.includes(needle);
  });
}

export function looksPortuguese(text: string): boolean {
  const ptMarks = PORTUGUESE_MARK.test(text);
  const ptWords = text.match(PORTUGUESE_WORDS)?.length ?? 0;
  const enWords = text.match(ENGLISH_WORDS)?.length ?? 0;
  if (enWords >= 2 && ptWords < 2 && !ptMarks) return false;
  if (enWords > 0 && ptWords === 0 && !ptMarks) return false;
  return ptMarks || ptWords >= 1;
}

function plain(value: string): string {
  return value.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
}

function tooLong(text: string): boolean {
  return text.length > MAX_CHARS || text.split(/[.!?]/).filter((part) => part.trim()).length > 2;
}

export function parseDailyNoteText(
  raw: unknown,
  allowCare: boolean,
  forbidden: string[] = [],
): { reflection: string; care: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { reflection?: unknown; care?: unknown };

  if (typeof body.reflection !== 'string') return null;
  const reflection = plain(body.reflection);
  if (!reflection || tooLong(reflection) || !looksPortuguese(reflection)) return null;
  if (soundsLikeReport(reflection, forbidden)) return null;

  if (!allowCare || body.care === null || body.care === undefined) {
    return { reflection, care: null };
  }
  if (typeof body.care !== 'string') return null;
  const care = plain(body.care);
  if (!care || care.toLowerCase() === 'null') return { reflection, care: null };
  if (tooLong(care) || !looksPortuguese(care) || soundsLikeReport(care, forbidden)) return null;
  return { reflection, care };
}
