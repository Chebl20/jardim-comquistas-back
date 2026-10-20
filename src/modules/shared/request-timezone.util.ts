export function readTimezoneFromRequest(
  req: { headers?: Record<string, string | string[] | undefined> },
  bodyTimezone?: string | null,
): string | undefined {
  const fromBody =
    bodyTimezone != null && String(bodyTimezone).trim()
      ? String(bodyTimezone).trim()
      : undefined;
  if (fromBody) return fromBody;

  const headers = req?.headers ?? {};
  const raw =
    headers['x-timezone'] ??
    headers['X-Timezone'] ??
    headers['timezone'] ??
    headers['Timezone'];
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}
