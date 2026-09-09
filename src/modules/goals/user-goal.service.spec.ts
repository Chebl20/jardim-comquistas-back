import { UserGoalService, resolveScheduleFields } from './user-goal.service';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';
import { BadRequestException } from '@nestjs/common';

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
    const now = DateTime.fromISO('2026-03-05T17:37:00', {
      zone: 'America/Sao_Paulo',
    });
    jest.spyOn(DateTime, 'now').mockReturnValue(now as DateTime<true>);

    const fields = resolveScheduleFields({
      scheduleConfig: { type: 'once', at: '17:40' },
      goalType: 'Pontual',
      userTimezone: 'America/Sao_Paulo',
    });

    expect(fields.scheduleFrequency).toBe('ONCE');
    const atLocal = DateTime.fromJSDate(fields.scheduleAt!).setZone(
      'America/Sao_Paulo',
    );
    expect(atLocal.toFormat('HH:mm')).toBe('17:40');
    expect(atLocal.day).toBe(5);

    jest.restoreAllMocks();
  });

  it('empurra lembrete pontual HH:MM no passado para o dia seguinte', () => {
    const now = DateTime.fromISO('2026-03-05T17:45:00', {
      zone: 'America/Sao_Paulo',
    });
    jest.spyOn(DateTime, 'now').mockReturnValue(now as DateTime<true>);

    const fields = resolveScheduleFields({
      scheduleConfig: { type: 'once', at: '17:40' },
      goalType: 'Pontual',
      userTimezone: 'America/Sao_Paulo',
    });

    const atLocal = DateTime.fromJSDate(fields.scheduleAt!).setZone(
      'America/Sao_Paulo',
    );
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
      },
      plantedTree: null,
      user: {
        id: 'user-1',
        name: 'Test',
        telegramId: null,
        timezone: 'America/Sao_Paulo',
      },
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

      const goalA = makeGoal({
        id: 'goal-a',
        title: 'Ler',
        conquestType: 'Mente',
      });
      const goalB = makeGoal({
        id: 'goal-b',
        title: 'Orar',
        conquestType: 'Espiritual',
      });

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

    it('não trata WAITING_REACTIVATION_REPLY legado como pendente de reativação', async () => {
      const goalA = makeGoal({
        id: 'goal-a',
        title: 'Estudar',
        conquestType: 'Mente',
      });

      mockGoalFindMany.mockResolvedValueOnce([goalA]).mockResolvedValueOnce([]);

      const result = await service.getIgnoredGoalsForToday(
        'user-1',
        'America/Sao_Paulo',
        [],
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('createUserGoalWithTree', () => {
    it('recusa create sem agenda (Goal+Reminder órfãos)', async () => {
      (prisma.goal as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue(null);
      (prisma as unknown as { treeCatalog?: { findFirst: jest.Mock } }).treeCatalog = {
        findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      };
      (prisma as unknown as { worldConfig?: { findUnique: jest.Mock } }).worldConfig = {
        findUnique: jest.fn().mockResolvedValue({
          anchors: [{ anchorId: 'a1', treeType: 'ground' }],
        }),
      };
      (prisma as unknown as { plantedTree?: { findFirst: jest.Mock } }).plantedTree = {
        findFirst: jest.fn().mockResolvedValue(null),
      };
      (prisma as unknown as { user?: { findUnique: jest.Mock } }).user = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      };
      (prisma as unknown as { $transaction?: jest.Mock }).$transaction = jest.fn();

      await expect(
        service.createUserGoalWithTree({
          userId: 'user-user-1',
          worldId: 'world-1',
          title: 'Ler',
          description: '10 páginas',
          conquestType: 'Mente',
          goalType: 'Continua',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        (prisma as unknown as { $transaction: jest.Mock }).$transaction,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Goal write ownership', () => {
    it('completeGoal recusa meta de outro usuário', async () => {
      (prisma.goal as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        service.completeGoal('goal-a', 'user-other'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completeGoal atualiza com id e userId', async () => {
      (prisma.goal as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'goal-a', userId: 'user-1' });
      (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await service.completeGoal('goal-a', 'user-1');

      expect(
        (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'goal-a', userId: 'user-1' },
        data: { completed: true },
      });
    });
  });

  describe('markGoalDoneFromReminder', () => {
    it('pontual: DONE no reminder e completed na Goal', async () => {
      (prisma.goal as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue({
          id: 'goal-p',
          userId: 'user-1',
          goalKind: 'Pontual',
        });
      (prisma.goalReminder as unknown as { upsert: jest.Mock }).upsert = jest
        .fn()
        .mockResolvedValue({});
      (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await service.markGoalDoneFromReminder('goal-p', 'user-1');

      expect(
        (prisma.goalReminder as unknown as { upsert: jest.Mock }).upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { goalId: 'goal-p' },
          update: { dailyStatus: 'DONE', silenceUntil: null },
        }),
      );
      expect(
        (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'goal-p', userId: 'user-1' },
        data: { completed: true },
      });
    });

    it('continua: DONE no reminder sem completed na Goal', async () => {
      (prisma.goal as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue({
          id: 'goal-c',
          userId: 'user-1',
          goalKind: 'Continua',
        });
      (prisma.goalReminder as unknown as { upsert: jest.Mock }).upsert = jest
        .fn()
        .mockResolvedValue({});
      (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany = jest.fn();

      await service.markGoalDoneFromReminder('goal-c', 'user-1');

      expect(
        (prisma.goal as unknown as { updateMany: jest.Mock }).updateMany,
      ).not.toHaveBeenCalled();
    });
  });
});
