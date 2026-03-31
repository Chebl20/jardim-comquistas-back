/**
 * Convenção do produto (alinhada a GoalSchedule no schema): 0=Dom, 1=Seg … 6=Sáb
 * (igual a Date.getDay() em JavaScript).
 */
export function luxonWeekdayToJsDayOfWeek(luxonWeekday: number): number {
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

/**
 * Normaliza `daysOfWeek` persistido em JSON (números ou strings).
 * Aceita 0–6 (JS) e também 1–7 no estilo ISO/Luxon (1=Seg … 7=Dom), mapeando 7 → 0.
 */
export function normalizeDaysOfWeekJson(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === 'string' ? parseInt(x, 10) : Number(x);
    if (!Number.isFinite(n)) continue;
    const v = Math.trunc(n);
    if (v === 7 || v === 0) {
      out.push(0);
      continue;
    }
    if (v >= 1 && v <= 6) {
      out.push(v);
      continue;
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
