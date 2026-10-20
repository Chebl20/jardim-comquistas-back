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
    expect(view.icon).toBe('fitness_center');
    expect(view.accentColor).toBe('garden-green');
  });

  it('Familia e Hobby_Lazer recebem o mesmo token do day', () => {
    expect(
      toGoalReminderView({
        id: 'g2',
        title: 'Abraço',
        goalKind: 'Pontual',
        conquestType: 'Familia',
        completed: false,
        createdAt: '2026-09-01T12:00:00.000Z',
      }),
    ).toMatchObject({
      icon: 'family_restroom',
      accentColor: 'accent-pink',
    });
    expect(
      toGoalReminderView({
        id: 'g3',
        title: 'Pescar',
        goalKind: 'Continua',
        conquestType: 'Hobby_Lazer',
        completed: false,
        createdAt: '2026-09-01T12:00:00.000Z',
      }),
    ).toMatchObject({
      icon: 'palette',
      accentColor: 'accent-pink',
    });
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

  it('UTC legado no user resolve para fuso da aplicação', () => {
    const view = toGoalReminderView({
      id: 'g1',
      title: 'Água',
      goalKind: 'Continua',
      conquestType: 'Corpo',
      completed: false,
      createdAt: '2026-09-01T12:00:00.000Z',
      user: {
        id: 'u1',
        name: 'Ana',
        telegramId: null,
        timezone: 'UTC',
      },
    });
    expect(view.timezone).toBe('America/Fortaleza');
  });
});
