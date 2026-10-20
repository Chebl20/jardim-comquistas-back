import { DateTime } from 'luxon';
import {
  isConfiguredUserTimezone,
  resolveUserTimezone,
} from './app-timezone';

export interface UserClockSnapshot {
  timezone: string;
  timezoneSource: 'user' | 'app_default';
  nowISO: string;
  localISO: string;
  nowFormatted: string;
  civilDate: string;
  weekday: string;
}

const CLOCK_QUERY_RE =
  /^(?:que\s+horas?(?:\s+(?:s[aã]o|é))?(?:\s+agora)?|hora\s+agora|hor[aá]rio\s+agora|que\s+horas?\s+e\s+agora)[\s!.?]*$/i;

export function isValidIanaTimezone(tz: string): boolean {
  const trimmed = tz.trim();
  if (!trimmed) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    return false;
  }
  const dt = DateTime.now().setZone(trimmed);
  return dt.isValid && dt.zoneName === trimmed;
}

export function normalizeTimezoneFromRequest(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return isValidIanaTimezone(trimmed) ? trimmed : null;
}

export function getUserDateTime(
  storedTimezone: string | null | undefined,
  at: Date = new Date(),
): DateTime {
  const zone = resolveUserTimezone(storedTimezone);
  return DateTime.fromJSDate(at, { zone });
}

export function buildUserClockSnapshot(
  storedTimezone: string | null | undefined,
  at: Date = new Date(),
): UserClockSnapshot {
  const timezone = resolveUserTimezone(storedTimezone);
  const timezoneSource = isConfiguredUserTimezone(storedTimezone)
    ? 'user'
    : 'app_default';
  const local = getUserDateTime(storedTimezone, at);

  const nowFormatted = at.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });

  const weekday = at.toLocaleDateString('pt-BR', {
    weekday: 'long',
    timeZone: timezone,
  });

  const civilDate =
    local.toISODate() ||
    at.toLocaleDateString('en-CA', { timeZone: timezone });

  return {
    timezone,
    timezoneSource,
    nowISO: at.toISOString(),
    localISO: local.toISO() || at.toISOString(),
    nowFormatted,
    civilDate,
    weekday,
  };
}

export function matchesUserClockQuery(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return CLOCK_QUERY_RE.test(normalized);
}

export function formatUserClockReply(
  storedTimezone: string | null | undefined,
  at: Date = new Date(),
): string {
  const snap = buildUserClockSnapshot(storedTimezone, at);
  const dateLabel = at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: snap.timezone,
  });
  const weekday =
    snap.weekday.charAt(0).toUpperCase() + snap.weekday.slice(1);
  return `Agora são ${snap.nowFormatted} (${weekday}, ${dateLabel}), no seu fuso ${snap.timezone}.`;
}
