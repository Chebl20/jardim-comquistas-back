jest.mock('../../prisma/client', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    growthEvent: { findMany: jest.fn() },
  },
}));

import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';
import { DashboardService } from './dashboard.service';
import { UserGoalService } from '../goals/user-goal.service';

describe('DashboardService.getDashboardWeek', () => {
  let service: DashboardService;
  const mockGetGoalsForUser = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService({
      getGoalsForUser: mockGetGoalsForUser,
    } as unknown as UserGoalService);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      timezone: 'America/Sao_Paulo',
    });
    (prisma.growthEvent.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('inclui times em weekGrid.goals para posicionamento na grade semanal', async () => {
    mockGetGoalsForUser.mockResolvedValue([
      {
        id: 'goal-1',
        title: 'Pescar',
        conquestType: 'Lazer',
        completed: false,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        schedule: { type: 'daily', times: ['09:30'] },
      },
      {
        id: 'goal-2',
        title: 'Beber água',
        conquestType: 'Corpo',
        completed: false,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        schedule: { type: 'daily', times: ['14:00'] },
      },
    ]);

    const result = await service.getDashboardWeek('user-1', '2026-08-26');

    expect(result.weekGrid).toHaveLength(7);
    const wednesday = result.weekGrid.find((d) => d.date === '2026-08-26');
    expect(wednesday).toBeDefined();
    expect(wednesday!.goals).toHaveLength(2);
    expect(wednesday!.goals[0]).toMatchObject({
      id: 'goal-1',
      title: 'Pescar',
      slots: 1,
      times: ['09:30'],
    });
    expect(wednesday!.goals[1]).toMatchObject({
      id: 'goal-2',
      title: 'Beber água',
      slots: 1,
      times: ['14:00'],
    });
  });
});

describe('DashboardService.getDashboardDay', () => {
  let service: DashboardService;
  const mockGetGoalsForDateForUser = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService({
      getGoalsForDateForUser: mockGetGoalsForDateForUser,
    } as unknown as UserGoalService);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      timezone: 'America/Sao_Paulo',
    });
  });

  it('não propaga dailyStatus DONE de hoje para data futura', async () => {
    jest.spyOn(DateTime, 'now').mockReturnValue(
      DateTime.fromISO('2026-08-26T15:00:00', {
        zone: 'America/Sao_Paulo',
      }) as DateTime<true>,
    );

    mockGetGoalsForDateForUser.mockResolvedValue([
      {
        id: 'goal-1',
        title: 'Beber água',
        conquestType: 'Corpo',
        dailyStatus: 'DONE',
        reminder: { dailyStatus: 'DONE' },
        schedule: { type: 'daily', times: ['08:00'] },
        plantedTree: { growthEvents: [] },
      },
    ]);

    const result = await service.getDashboardDay('user-1', '2026-08-27');

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].dailyStatus).toBe('PENDING');
    expect(result.goals[0].reminder.dailyStatus).toBe('PENDING');
    expect(result.goals[0].silenceUntil).toBeNull();

    jest.restoreAllMocks();
  });

  it('hoje com DONE residual de ontem volta PENDING (CONTINUA diária)', async () => {
    jest.spyOn(DateTime, 'now').mockReturnValue(
      DateTime.fromISO('2026-08-27T10:00:00', {
        zone: 'America/Sao_Paulo',
      }) as DateTime<true>,
    );

    mockGetGoalsForDateForUser.mockResolvedValue([
      {
        id: 'goal-1',
        title: 'Correr 5km',
        conquestType: 'Corpo',
        dailyStatus: 'DONE',
        reminderUpdatedAt: '2026-08-26T18:00:00.000-03:00',
        reminder: {
          dailyStatus: 'DONE',
          updatedAt: '2026-08-26T18:00:00.000-03:00',
        },
        schedule: { type: 'daily', times: ['07:00'] },
        plantedTree: {
          growthEvents: [
            { createdAt: '2026-01-01T12:00:00.000Z', progressIndex: 1 },
            { createdAt: '2026-08-26T18:00:00.000-03:00', progressIndex: 2 },
          ],
        },
      },
    ]);

    const result = await service.getDashboardDay('user-1', '2026-08-27');

    expect(result.goals[0].dailyStatus).toBe('PENDING');
    expect(result.goals[0].reminder.dailyStatus).toBe('PENDING');

    jest.restoreAllMocks();
  });
});
