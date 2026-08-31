import { UserGoalService, resolveScheduleFields } from './user-goal.service';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';

jest.mock('../../prisma/client', () => ({
  prisma: {
    goal: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    goalReminder: {
      findMany: jest.fn(),
    },
    goalOccurrenceException: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

describe('resolveScheduleFields', () => {
  it('agenda lembrete pontual HH:MM no futuro para hoje', () => {
    const now = DateTime.fromISO('2026-03-05T17:37:00', { zone: 'America/Sao_Paulo' });
    jest.spyOn(DateTime, 'now').mockReturnValue(now as DateTime<true>);

    const fields = resolveScheduleFields({
      scheduleConfig: { type: 'once', at: '17:40' },
      goalType: 'Pontual',
      userTimezone: 'America/Sao_Paulo',
    });

    expect(fields.scheduleFrequency).toBe('ONCE');
    const atLocal = DateTime.fromJSDate(fields.scheduleAt!).setZone('America/Sao_Paulo');
    expect(atLocal.toFormat('HH:mm')).toBe('17:40');
    expect(atLocal.day).toBe(5);

    jest.restoreAllMocks();
  });

  it('empurra lembrete pontual HH:MM no passado para o dia seguinte', () => {
    const now = DateTime.fromISO('2026-03-05T17:45:00', { zone: 'America/Sao_Paulo' });
    jest.spyOn(DateTime, 'now').mockReturnValue(now as DateTime<true>);

    const fields = resolveScheduleFields({
      scheduleConfig: { type: 'once', at: '17:40' },
      goalType: 'Pontual',
      userTimezone: 'America/Sao_Paulo',
    });

    const atLocal = DateTime.fromJSDate(fields.scheduleAt!).setZone('America/Sao_Paulo');
    expect(atLocal.toFormat('HH:mm')).toBe('17:40');
    expect(atLocal.day).toBe(6);

    jest.restoreAllMocks();
  });

  it('persiste DAILY + times para meta continua mesmo com type DAILY do LLM', () => {
    const fields = resolveScheduleFields({
      scheduleConfig: { type: 'DAILY', times: '10:00' } as any,
      goalType: 'Continua',
      userTimezone: 'America/Sao_Paulo',
    });
    expect(fields.scheduleFrequency).toBe('DAILY');
    expect(fields.scheduleTimes).toEqual(['10:00']);
  });
});

describe('UserGoalService', () => {
  let service: UserGoalService;
  const mockGoalFindMany = prisma.goal.findMany as jest.Mock;

  // Helper para construir um goal com schedule e reminder no formato do banco
  function makeGoal(overrides: Partial<any> = {}) {
    const now = DateTime.now().setZone('America/Sao_Paulo');
    return {
      id: 'goal-a',
      userId: 'user-1',
      title: 'Ler',
      description: null,
      goalKind: 'Continua',
      conquestType: 'Mente',
      completed: false,
      createdAt: new Date(),
      schedule: {
        id: 'sched-a',
        goalId: 'goal-a',
        frequency: 'DAILY',
        times: [now.toFormat('HH:mm')],
        daysOfWeek: null,
        durationDays: null,
        timeZone: 'America/Sao_Paulo',
        at: null,
        dtStart: null,
        dtEnd: null,
      },
      reminder: {
        id: 'rem-a',
        goalId: 'goal-a',
        dailyStatus: null,
        slotsToday: null,
        lastSentAt: null,
        sentCount: 0,
        silenceUntil: null,
        minutesBefore: 0,
      },
      plantedTree: null,
      user: { id: 'user-1', name: 'Test', telegramId: null, timezone: 'America/Sao_Paulo' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserGoalService({} as any, {} as any, {} as any);
  });

  describe('getIgnoredGoalsForToday', () => {
    it('inclui metas com status MISSED na lista de pendentes', async () => {
      const now = DateTime.now().setZone('America/Sao_Paulo');
      const todayStart = now.startOf('day').toJSDate();
      const todayEnd = now.endOf('day').toJSDate();

      const goalA = makeGoal({ id: 'goal-a', title: 'Ler', conquestType: 'Mente' });
      const goalB = makeGoal({ id: 'goal-b', title: 'Orar', conquestType: 'Espiritual' });

      // 1a chamada: getGoalsForUser (usado por getGoalsForTodayForUser)
      mockGoalFindMany
        .mockResolvedValueOnce([goalA, goalB])
        // 2a chamada: getIgnoredGoalsForToday -> segunda query com filtro reminder
        .mockResolvedValueOnce([
          { id: 'goal-a', title: 'Ler', reminder: { dailyStatus: 'MISSED' } },
        ]);

      const result = await service.getIgnoredGoalsForToday(
        'user-1',
        'America/Sao_Paulo',
        ['goal-b'],
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('goal-a');
      expect(result[0].title).toBe('Ler');
      expect(result[0].dailyStatus).toBe('MISSED');
    });

    it('inclui metas com status WAITING_REACTIVATION_REPLY na lista de pendentes', async () => {
      const goalA = makeGoal({ id: 'goal-a', title: 'Estudar', conquestType: 'Mente' });

      mockGoalFindMany
        .mockResolvedValueOnce([goalA])
        .mockResolvedValueOnce([
          { id: 'goal-a', title: 'Estudar', reminder: { dailyStatus: 'WAITING_REACTIVATION_REPLY' } },
        ]);

      const result = await service.getIgnoredGoalsForToday(
        'user-1',
        'America/Sao_Paulo',
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0].dailyStatus).toBe('WAITING_REACTIVATION_REPLY');
    });
  });
});
