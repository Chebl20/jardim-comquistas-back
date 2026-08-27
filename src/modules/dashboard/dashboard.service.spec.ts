jest.mock('../../prisma/client', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    growthEvent: { findMany: jest.fn() },
  },
}));

import { prisma } from '../../prisma/client';
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
        scheduleConfig: { type: 'daily', times: ['09:30'] },
      },
      {
        id: 'goal-2',
        title: 'Beber água',
        conquestType: 'Corpo',
        completed: false,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        scheduleConfig: { type: 'daily', times: ['14:00'] },
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
