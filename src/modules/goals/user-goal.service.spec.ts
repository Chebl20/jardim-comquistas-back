import { UserGoalService } from './user-goal.service';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';

jest.mock('../../prisma/client', () => ({
  prisma: {
    userGoal: {
      findMany: jest.fn(),
    },
  },
}));

describe('UserGoalService', () => {
  let service: UserGoalService;
  const mockFindMany = prisma.userGoal.findMany as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserGoalService({} as any, {} as any);
  });

  describe('getIgnoredGoalsForToday', () => {
    it('inclui metas com status MISSED na lista de pendentes', async () => {
      const now = DateTime.now().setZone('America/Sao_Paulo');
      const todayStart = now.startOf('day').toJSDate();
      const todayEnd = now.endOf('day').toJSDate();

      const goalA = {
        id: 'goal-a',
        title: 'Ler',
        description: null,
        goalType: 'Continua',
        conquestType: 'Mente',
        completed: false,
        reminderTime: new Date(now.toISO()),
        scheduleConfig: null,
        frequency: 1,
        createdAt: new Date(),
        plantedTree: null,
      };

      const goalB = {
        id: 'goal-b',
        title: 'Orar',
        description: null,
        goalType: 'Continua',
        conquestType: 'Espiritual',
        completed: false,
        reminderTime: new Date(now.toISO()),
        scheduleConfig: null,
        frequency: 1,
        createdAt: new Date(),
        plantedTree: null,
      };

      mockFindMany
        .mockResolvedValueOnce([goalA, goalB])
        .mockResolvedValueOnce([
          { id: 'goal-a', title: 'Ler', dailyStatus: 'MISSED' },
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

      const secondCall = mockFindMany.mock.calls[1];
      expect(secondCall[0].where.dailyStatus.in).toContain('MISSED');
      expect(secondCall[0].where.dailyStatus.in).toContain(
        'WAITING_REACTIVATION_REPLY',
      );
    });

    it('inclui metas com status WAITING_REACTIVATION_REPLY na lista de pendentes', async () => {
      const now = DateTime.now().setZone('America/Sao_Paulo');

      const goalA = {
        id: 'goal-a',
        title: 'Estudar',
        description: null,
        goalType: 'Continua',
        conquestType: 'Mente',
        completed: false,
        reminderTime: new Date(now.toISO()),
        scheduleConfig: null,
        frequency: 1,
        createdAt: new Date(),
        plantedTree: null,
      };

      mockFindMany
        .mockResolvedValueOnce([goalA])
        .mockResolvedValueOnce([
          { id: 'goal-a', title: 'Estudar', dailyStatus: 'WAITING_REACTIVATION_REPLY' },
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
