import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import {
  expectedSlotCountForGoalOnDate,
  monthRangeFromInput,
  weekRangeContainingDate,
} from '../shared/schedule-occurrence.util';

@Injectable()
export class ProgressService {
  constructor(private readonly userGoalService: UserGoalService) {}

  async getWeeklyProgress(userId: string, date: string, areaId?: string) {
    const area =
      areaId && String(areaId).trim() ? String(areaId).trim() : undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz =
      user?.timezone && String(user.timezone).trim()
        ? user.timezone
        : 'America/Sao_Paulo';

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

    const { monday, sundayEnd, nextMonday } = weekRangeContainingDate(
      anchor,
      tz,
    );

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
      total === 0
        ? 0
        : Math.min(100, Math.round((Math.min(harvested, total) / total) * 100));

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
    const area =
      areaId && String(areaId).trim() ? String(areaId).trim() : undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz =
      user?.timezone && String(user.timezone).trim()
        ? user.timezone
        : 'America/Sao_Paulo';

    const parsed = monthRangeFromInput(month, tz);
    if (!parsed) {
      return {
        period: 'month',
        month,
        areaId: area ?? null,
        completionRate: 0,
        activeDays: 0,
        harvested: 0,
        total: 0,
      };
    }

    const { monthStart, nextMonthStart } = parsed;

    const goals = await this.userGoalService.getGoalsForUser(userId);
    const inScope = goals.filter((g: any) => {
      if (g.completed) return false;
      const st = g.status ?? 'ACTIVE';
      if (st !== 'ACTIVE') return false;
      if (area && String(g.conquestType) !== area) return false;
      return true;
    });

    let total = 0;
    const daysInMonth = nextMonthStart.diff(monthStart, 'days').days;
    for (let i = 0; i < daysInMonth; i++) {
      const d = monthStart.plus({ days: i });
      for (const g of inScope) {
        total += expectedSlotCountForGoalOnDate(g, d, tz);
      }
    }

    const harvested = await prisma.growthEvent.count({
      where: {
        createdAt: {
          gte: monthStart.toUTC().toJSDate(),
          lt: nextMonthStart.toUTC().toJSDate(),
        },
        plantedTree: {
          goal: {
            userId,
            ...(area ? { conquestType: area } : {}),
          },
        },
      },
    });

    // activeDays: dias distintos com ao menos 1 harvest no mês
    const rawEvents = await prisma.growthEvent.findMany({
      where: {
        createdAt: {
          gte: monthStart.toUTC().toJSDate(),
          lt: nextMonthStart.toUTC().toJSDate(),
        },
        plantedTree: {
          goal: {
            userId,
            ...(area ? { conquestType: area } : {}),
          },
        },
      },
      select: { createdAt: true },
    });
    const activeDaySet = new Set(
      rawEvents.map((e) =>
        DateTime.fromJSDate(e.createdAt).setZone(tz).toISODate(),
      ),
    );
    const activeDays = activeDaySet.size;

    const completionRate =
      total === 0
        ? 0
        : Math.min(100, Math.round((Math.min(harvested, total) / total) * 100));

    return {
      period: 'month',
      month: monthStart.toFormat('yyyy-MM'),
      areaId: area ?? null,
      completionRate,
      activeDays,
      harvested,
      total,
    };
  }

  async getStreaks(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz =
      user?.timezone && String(user.timezone).trim()
        ? user.timezone
        : 'America/Sao_Paulo';

    // Busca todos os growthEvents do usuário, ordenados por data desc
    const events = await prisma.growthEvent.findMany({
      where: {
        plantedTree: { goal: { userId } },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!events.length) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    // Agrupa por dia (YYYY-MM-DD no timezone do usuário) e deduplica
    const daySet = new Set(
      events.map((e) =>
        DateTime.fromJSDate(e.createdAt).setZone(tz).toISODate(),
      ),
    );
    const days = Array.from(daySet).sort().reverse(); // mais recente primeiro

    const today = DateTime.now().setZone(tz).toISODate();
    const yesterday = DateTime.now().setZone(tz).minus({ days: 1 }).toISODate();

    // currentStreak: sequência contínua de dias terminando em hoje ou ontem
    let currentStreak = 0;
    if (days[0] === today || days[0] === yesterday) {
      let prev = DateTime.fromISO(days[0] as string, { zone: tz });
      for (const d of days) {
        const curr = DateTime.fromISO(d as string, { zone: tz });
        const diff = prev.diff(curr, 'days').days;
        if (diff <= 1) {
          currentStreak++;
          prev = curr;
        } else {
          break;
        }
      }
    }

    // longestStreak: maior sequência em qualquer período
    let longestStreak = 0;
    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      const curr = DateTime.fromISO(days[i] as string, { zone: tz });
      const prev = DateTime.fromISO(days[i - 1] as string, { zone: tz });
      const diff = prev.diff(curr, 'days').days;
      if (diff === 1) {
        streak++;
        longestStreak = Math.max(longestStreak, streak);
      } else {
        streak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak, days.length > 0 ? 1 : 0);

    return { currentStreak, longestStreak };
  }
}
