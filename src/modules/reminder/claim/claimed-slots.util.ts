import { DateTime } from 'luxon';
import { makeOccKey, parseOccKey } from '../../shared/occurrence-key.util';

export type ClaimedSlot = {
  occKey: string;
  time: string;
  civilDate: string;
  status: string;
};

export type ClaimedReadContext = {
  lastSentAt?: Date | string | null;
  timezone?: string;
};

function lastSentCivilDate(ctx?: ClaimedReadContext): string | null {
  if (!ctx?.lastSentAt) return null;
  const tz = ctx.timezone || 'UTC';
  const dt =
    ctx.lastSentAt instanceof Date
      ? DateTime.fromJSDate(ctx.lastSentAt, { zone: tz })
      : DateTime.fromISO(String(ctx.lastSentAt), { zone: tz });
  if (!dt.isValid) return null;
  return dt.toISODate();
}

/**
 * Dual-read: JSON datado `{ occKey, status }` / `{ date, time, status }`
 * e legado `{ time }` só se `lastSentAt` cair no mesmo civilDate de avaliação.
 */
export function readClaimedSlots(
  slotsToday: unknown,
  evaluationCivilDate: string,
  ctx?: ClaimedReadContext,
): ClaimedSlot[] {
  if (!Array.isArray(slotsToday)) return [];
  const legacyOk = lastSentCivilDate(ctx) === evaluationCivilDate;
  const out: ClaimedSlot[] = [];
  for (const raw of slotsToday) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.occKey === 'string') {
      const parsed = parseOccKey(s.occKey);
      if (!parsed) continue;
      out.push({
        occKey: s.occKey,
        time: parsed.hhmm,
        civilDate: parsed.civilDate,
        status: typeof s.status === 'string' ? s.status : 'SENT',
      });
      continue;
    }
    if (typeof s.date === 'string' && typeof s.time === 'string') {
      const occKey = makeOccKey(s.date, s.time);
      out.push({
        occKey,
        time: s.time,
        civilDate: s.date,
        status: typeof s.status === 'string' ? s.status : 'SENT',
      });
      continue;
    }
    if (typeof s.time === 'string' && legacyOk) {
      out.push({
        occKey: makeOccKey(evaluationCivilDate, s.time),
        time: s.time,
        civilDate: evaluationCivilDate,
        status: typeof s.status === 'string' ? s.status : 'SENT',
      });
    }
  }
  return out;
}

export function claimedTimesForCivilDate(
  slotsToday: unknown,
  civilDate: string,
  ctx?: ClaimedReadContext,
): string[] {
  return readClaimedSlots(slotsToday, civilDate, ctx)
    .filter((s) => s.civilDate === civilDate)
    .map((s) => s.time);
}

export function appendClaimedSlot(
  slotsToday: unknown,
  occKey: string,
  status: string,
  evaluationCivilDate: string,
  ctx?: ClaimedReadContext,
): ClaimedSlot[] {
  const parsed = parseOccKey(occKey);
  if (!parsed) return readClaimedSlots(slotsToday, evaluationCivilDate, ctx);
  const existing = readClaimedSlots(
    slotsToday,
    evaluationCivilDate,
    ctx,
  ).filter((s) => s.occKey !== occKey);
  existing.push({
    occKey,
    time: parsed.hhmm,
    civilDate: parsed.civilDate,
    status,
  });
  return existing;
}

export function claimedSlotsToJson(
  slots: ClaimedSlot[],
): Array<{ occKey: string; time: string; date: string; status: string }> {
  return slots.map((s) => ({
    occKey: s.occKey,
    time: s.time,
    date: s.civilDate,
    status: s.status,
  }));
}
