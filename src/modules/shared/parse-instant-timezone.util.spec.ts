import { DateTime } from 'luxon';
import { parseInstantInTimezone } from './parse-instant-timezone.util';

const TZ = 'America/Fortaleza';

describe('parseInstantInTimezone', () => {
  it('interpreta HH:mm no fuso do usuário (hoje civil)', () => {
    const dt = parseInstantInTimezone('09:00', TZ)!;
    expect(dt.zoneName).toBe(TZ);
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(0);
  });

  it('ISO sem offset usa timezone, não UTC', () => {
    const dt = parseInstantInTimezone('2026-09-02T09:00:00', TZ)!;
    expect(dt.toUTC().toISO()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('ISO com offset Z preserva instante', () => {
    const dt = parseInstantInTimezone('2026-09-02T12:00:00.000Z', TZ)!;
    expect(dt.toUTC().toISO()).toBe('2026-09-02T12:00:00.000Z');
    expect(dt.setZone(TZ).hour).toBe(9);
  });

  it('Date usa instante absoluto no fuso pedido', () => {
    const js = new Date('2026-09-02T12:00:00.000Z');
    const dt = parseInstantInTimezone(js, TZ)!;
    expect(dt.hour).toBe(9);
  });

  it('retorna null para valor inválido', () => {
    expect(parseInstantInTimezone('not-a-date', TZ)).toBeNull();
  });
});
