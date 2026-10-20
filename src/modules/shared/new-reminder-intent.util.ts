/**
 * Pedido de NOVO lembrete/meta (agendar), não resposta a lembrete já enviado.
 * Usado para o núcleo REMINDER devolver NOT_MY_JOB e o roteador encaminhar a GOAL_CREATION.
 */
const DISMISS_OR_SNOOZE_RE =
  /\b(n[aã]o\s+me\s+lembr|n[aã]o\s+vou\s+conseguir|para\s+de\s+me\s+lembr|s[oó]\s+amanh[aã]|depois|mais\s+tarde|daqui\s+a\s+pouco)\b/i;

const SCHEDULE_TIME_RE =
  /\b(\d{1,2}:\d{2}|\d{1,2}\s*h(?:\s*\d{1,2})?)\b/i;

const CREATE_REMINDER_RE =
  /\b((me\s+)?lembr(a|e|ar)|me\s+avisa|me\s+avise|cri(ar|e)\s+(uma\s+)?(meta|lembrete)|quero\s+ser\s+lembrad|agendar\s+(um\s+)?lembrete)\b/i;

const RELATIVE_SCHEDULE_RE =
  /\bdaqui\s+a\s+\d+\s*(min(?:uto)?s?|hora?s?|h)\b/i;

export function looksLikeNewReminderOrGoalRequest(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (DISMISS_OR_SNOOZE_RE.test(normalized) && !SCHEDULE_TIME_RE.test(normalized)) {
    return false;
  }
  if (!CREATE_REMINDER_RE.test(normalized)) return false;
  if (SCHEDULE_TIME_RE.test(normalized)) return true;
  if (RELATIVE_SCHEDULE_RE.test(normalized)) return true;
  if (/\bcri(ar|e)\s+(uma\s+)?meta\b/i.test(normalized)) return true;
  return false;
}
