import { DateTime } from 'luxon';

const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** ISO com offset explícito (Z ou ±hh:mm). */
function hasExplicitOffset(iso: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim());
}

/**
 * Interpreta Date / ISO / HH:mm no fuso informado, sem forçar UTC em ISO sem offset.
 */
export function parseInstantInTimezone(
  value: Date | string | null | undefined,
  timezone: string,
): DateTime | null {
  if (value == null) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return DateTime.fromJSDate(value, { zone: timezone });
  }

  const str = String(value).trim();
  if (!str) return null;

  const timeOnly = str.match(TIME_ONLY_RE);
  if (timeOnly) {
    const hh = parseInt(timeOnly[1], 10);
    const mm = parseInt(timeOnly[2], 10);
    const ss = parseInt(timeOnly[3] || '0', 10);
    return DateTime.now()
      .setZone(timezone)
      .set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
  }

  if (hasExplicitOffset(str)) {
    const iso = DateTime.fromISO(str, { setZone: true });
    return iso.isValid ? iso : null;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(str) || str.includes('T')) {
    const local = DateTime.fromISO(str, { zone: timezone });
    if (local.isValid) return local;
  }

  const jsDate = new Date(str);
  if (!Number.isNaN(jsDate.getTime())) {
    return DateTime.fromJSDate(jsDate, { zone: timezone });
  }

  return null;
}
