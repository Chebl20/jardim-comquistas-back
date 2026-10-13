import { resolveReminderTime } from './goal-creation.util';

describe('resolveReminderTime timezone', () => {
  it('ISO sem offset é interpretado no TZ do user (Manaus ≠ SP)', () => {
    const now = new Date('2026-09-02T12:00:00.000Z');
    const manaus = resolveReminderTime(
      '2026-09-02T08:00:00',
      now,
      'America/Manaus',
    );
    const sp = resolveReminderTime(
      '2026-09-02T08:00:00',
      now,
      'America/Sao_Paulo',
    );
    expect(manaus).toBe('2026-09-02T12:00:00.000Z');
    expect(sp).toBe('2026-09-02T11:00:00.000Z');
  });
});
