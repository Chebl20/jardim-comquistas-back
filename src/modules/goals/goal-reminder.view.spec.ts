import { toGoalReminderView } from './goal-reminder.view';

describe('toGoalReminderView', () => {
  it('DAILY + times JSON → schedule canônico', () => {
    const view = toGoalReminderView({
      id: 'g1',
      userId: 'u1',
      title: 'Água',
      goalKind: 'Continua',
      conquestType: 'Corpo',
      completed: false,
      createdAt: '2026-09-01T12:00:00.000Z',
      schedule: {
        frequency: 'DAILY',
        times: ['08:00', '18:00'],
        timeZone: 'America/Sao_Paulo',
      },
      reminder: { sentCount: 0 },
    });
    expect(view.schedule).toEqual({ type: 'daily', times: ['08:00', '18:00'] });
  });

  it('timezone do user ganha de schedule.timeZone', () => {
    const view = toGoalReminderView({
      id: 'g1',
      userId: 'u1',
      title: 'Água',
      goalKind: 'Continua',
      conquestType: 'Corpo',
      completed: false,
      createdAt: '2026-09-01T12:00:00.000Z',
      schedule: { frequency: 'DAILY', times: ['08:00'], timeZone: 'UTC' },
      user: {
        id: 'u1',
        name: 'Ana',
        telegramId: null,
        timezone: 'America/Manaus',
      },
    });
    expect(view.timezone).toBe('America/Manaus');
  });

  it('sem user.timezone usa schedule.timeZone', () => {
    const view = toGoalReminderView({
      id: 'g1',
      title: 'Água',
      goalKind: 'Continua',
      conquestType: 'Corpo',
      completed: false,
      createdAt: '2026-09-01T12:00:00.000Z',
      schedule: {
        frequency: 'DAILY',
        times: ['08:00'],
        timeZone: 'America/Recife',
      },
    });
    expect(view.timezone).toBe('America/Recife');
  });
});
