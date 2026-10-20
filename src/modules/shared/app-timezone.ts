/**
 * Fuso horário padrão da aplicação (São Luís / Maranhão).
 * Configurável via APP_TIMEZONE; não confundir com TZ do processo Node.
 */
export const DEFAULT_APP_TIMEZONE = 'America/Fortaleza';

export function getAppTimezone(): string {
  const raw = process.env.APP_TIMEZONE?.trim();
  return raw || DEFAULT_APP_TIMEZONE;
}

/** Valores tratados como “usuário não configurou fuso” (legado Prisma UTC). */
const UNCONFIGURED_TIMEZONES = new Set(['', 'UTC', 'Etc/UTC', 'GMT', 'Etc/GMT']);

/**
 * Resolve o IANA timezone para agendamento e lembretes.
 * Ausente, em branco ou UTC legado → fuso da aplicação.
 */
export function resolveUserTimezone(
  value: string | null | undefined,
): string {
  const trimmed = value != null ? String(value).trim() : '';
  if (!trimmed || UNCONFIGURED_TIMEZONES.has(trimmed)) {
    return getAppTimezone();
  }
  return trimmed;
}
