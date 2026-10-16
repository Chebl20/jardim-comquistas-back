export type ParsedGoalInstanceId = {
  goalId: string;
  date: string | null;
  startTime: string | null;
};

const INSTANCE_RE = /^([^:]+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildGoalInstanceId(
  goalId: string,
  date: string,
  startTime: string,
): string {
  return `${goalId}:${date}:${startTime}`;
}

export function parseGoalInstanceId(raw: string): ParsedGoalInstanceId | null {
  let decoded = String(raw || '').trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* already decoded */
  }

  const match = decoded.match(INSTANCE_RE);
  if (match) {
    return { goalId: match[1], date: match[2], startTime: match[3] };
  }

  if (UUID_RE.test(decoded)) {
    return { goalId: decoded, date: null, startTime: null };
  }

  return null;
}
