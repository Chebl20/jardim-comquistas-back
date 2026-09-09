/** Identidade de ocorrência: dia civil no tz do usuário + horário HH:MM. */
export type OccurrenceRef = {
  civilDate: string;
  hhmm: string;
};

export function makeOccKey(civilDate: string, hhmm: string): string {
  return `${civilDate}T${hhmm}`;
}

export function parseOccKey(occKey: string): OccurrenceRef | null {
  const m = String(occKey || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!m) return null;
  return { civilDate: m[1], hhmm: m[2] };
}

export function civilDateInZone(isoDateTime: {
  toISODate(): string | null;
}): string {
  return isoDateTime.toISODate() || '';
}
