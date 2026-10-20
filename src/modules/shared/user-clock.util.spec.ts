import {
  buildUserClockSnapshot,
  formatUserClockReply,
  isValidIanaTimezone,
  matchesUserClockQuery,
  normalizeTimezoneFromRequest,
} from './user-clock.util';

describe('user-clock.util', () => {
  const fixed = new Date('2026-09-02T15:42:00.000Z');

  it('isValidIanaTimezone aceita IANA conhecido e rejeita inválido', () => {
    expect(isValidIanaTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidIanaTimezone('Not/AZone')).toBe(false);
    expect(isValidIanaTimezone('')).toBe(false);
  });

  it('normalizeTimezoneFromRequest retorna null para inválido', () => {
    expect(normalizeTimezoneFromRequest(' America/Manaus ')).toBe(
      'America/Manaus',
    );
    expect(normalizeTimezoneFromRequest('bogus')).toBeNull();
    expect(normalizeTimezoneFromRequest(null)).toBeNull();
  });

  it('buildUserClockSnapshot usa fuso do usuário', () => {
    const snap = buildUserClockSnapshot('America/Manaus', fixed);
    expect(snap.timezone).toBe('America/Manaus');
    expect(snap.timezoneSource).toBe('user');
    expect(snap.civilDate).toBe('2026-09-02');
    expect(snap.nowFormatted).toMatch(/^\d{2}:\d{2}$/);
  });

  it('buildUserClockSnapshot marca app_default para UTC legado', () => {
    const snap = buildUserClockSnapshot('UTC', fixed);
    expect(snap.timezoneSource).toBe('app_default');
    expect(snap.timezone).toBe('America/Fortaleza');
  });

  it('Manaus vs Fortaleza no mesmo instante', () => {
    const manaus = buildUserClockSnapshot('America/Manaus', fixed);
    const fortaleza = buildUserClockSnapshot('America/Fortaleza', fixed);
    expect(manaus.nowFormatted).not.toBe(fortaleza.nowFormatted);
  });

  it('matchesUserClockQuery reconhece frases comuns', () => {
    expect(matchesUserClockQuery('que horas são')).toBe(true);
    expect(matchesUserClockQuery('Que horas são agora?')).toBe(true);
    expect(matchesUserClockQuery('hora agora')).toBe(true);
    expect(matchesUserClockQuery('quais são minhas metas')).toBe(false);
  });

  it('formatUserClockReply inclui horário e fuso', () => {
    const text = formatUserClockReply('America/Sao_Paulo', fixed);
    expect(text).toContain('Agora são');
    expect(text).toContain('America/Sao_Paulo');
  });
});
