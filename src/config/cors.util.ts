/**
 * Parses CORS_ALLOWED_ORIGINS: empty or * = allow any origin (reflect);
 * otherwise comma-separated explicit origins.
 */
export function resolveCorsOrigin(
  envValue: string | undefined,
): true | string[] {
  const raw = (envValue ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (raw.length === 0 || raw.includes('*')) {
    return true;
  }
  return raw;
}
