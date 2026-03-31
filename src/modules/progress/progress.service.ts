import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import { expectedSlotCountForGoalOnDate, weekRangeContainingDate } from '../shared/schedule-occurrence.util';

@Injectable()
export class ProgressService {
  constructor(private readonly userGoalService: UserGoalService) {}

  async getWeeklyProgress(userId: string, date: string, areaId?: string) {
    const area = areaId && String(areaId).trim() ? String(areaId).trim() : undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone && String(user.timezone).trim() ? user.timezone : 'America/Sao_Paulo';

    const datePart = String(date || '').slice(0, 10);
    const anchor = DateTime.fromISO(datePart, { zone: tz });
    if (!anchor.isValid) {
      return {
        period: 'week',
        date: datePart || null,
        areaId: area ?? null,
        completionRate: 0,
        harvested: 0,
        total: 0,
      };
    }

    const { monday, sundayEnd, nextMonday } = weekRangeContainingDate(anchor, tz);

    const goals = await this.userGoalService.getGoalsForUser(userId);
    const inScope = goals.filter((g: any) => {
      if (g.completed) return false;
      const st = g.status ?? 'ACTIVE';
      if (st !== 'ACTIVE') return false;
      if (area && String(g.conquestType) !== area) return false;
      return true;
    });

    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = monday.plus({ days: i });
      for (const g of inScope) {
        total += expectedSlotCountForGoalOnDate(g, d, tz);
      }
    }

    const harvested = await prisma.growthEvent.count({
      where: {
        createdAt: {
          gte: monday.toUTC().toJSDate(),
          lt: nextMonday.toUTC().toJSDate(),
        },
        plantedTree: {
          goal: {
            userId,
            ...(area ? { conquestType: area } : {}),
          },
        },
      },
    });

    const completionRate =
      total === 0 ? 0 : Math.min(100, Math.round((Math.min(harvested, total) / total) * 100));

    return {
      period: 'week',
      date: datePart,
      areaId: area ?? null,
      weekStart: monday.toISODate(),
      weekEnd: sundayEnd.toISODate(),
      completionRate,
      harvested,
      total,
    };
  }

  async getMonthlyProgress(userId: string, month: string, areaId?: string) {
    return {
      period: 'month',
      month,
      areaId: areaId || null,
      completionRate: 40,
      activeDays: 15,
    };
  }

  async getStreaks(userId: string) {
    return { currentStreak: 5, longestStreak: 12 };
  }
}
