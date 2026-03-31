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
export class DashboardService {
  constructor(private readonly userGoalService: UserGoalService) {}

  async getDashboardDay(userId: string, date: string, areaId?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone && String(user.timezone).trim() ? user.timezone : 'America/Sao_Paulo';

    const datePart = String(date || '').slice(0, 10);
    const day = DateTime.fromISO(datePart, { zone: tz });
    const targetDate = day.isValid ? day : DateTime.now().setZone(tz);

    let goals = await this.userGoalService.getGoalsForDateForUser(userId, targetDate, tz, {
      includeCompleted: true,
    });
    if (areaId && String(areaId).trim()) {
      const a = String(areaId).trim();
      goals = goals.filter((g: any) => String(g.conquestType) === a);
    }

    return {
      date: datePart,
      areaId: areaId && String(areaId).trim() ? String(areaId).trim() : null,
      goals,
      summary: 'Resumo do dia',
      bloomingToday: [],
      growth: { percentage: 0 },
      careNeeded: [],
      harvestSummary: { collected: 0, total: goals.length },
      guideSuggestions: [],
    };
  }

  async getDashboardWeek(userId: string, date: string, areaId?: string) {
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
        date: datePart || null,
        areaId: area ?? null,
        weekStart: null,
        weekEnd: null,
        weekGrid: [],
        weeklyProgress: { percentage: 0, total: 0, harvested: 0 },
        harvestCount: 0,
        gardenLayers: [],
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

    let totalSlots = 0;
    const weekGrid: Array<{
      date: string | null;
      expectedSlots: number;
      harvestCount: number;
      goals: { id: string; title: string; conquestType: string; slots: number }[];
    }> = [];

    for (let i = 0; i < 7; i++) {
      const d = monday.plus({ days: i });
      const dayGoals: { id: string; title: string; conquestType: string; slots: number }[] = [];
      let expectedSlots = 0;
      for (const g of inScope) {
        const n = expectedSlotCountForGoalOnDate(g, d, tz);
        if (n > 0) {
          expectedSlots += n;
          dayGoals.push({
            id: g.id,
            title: g.title,
            conquestType: g.conquestType,
            slots: n,
          });
        }
      }
      totalSlots += expectedSlots;
      weekGrid.push({
        date: d.toISODate(),
        expectedSlots,
        harvestCount: 0,
        goals: dayGoals,
      });
    }

    const growthEvents = await prisma.growthEvent.findMany({
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
      select: { createdAt: true },
    });

    const harvestByDay = new Map<string, number>();
    for (const ev of growthEvents) {
      const key = DateTime.fromJSDate(ev.createdAt).setZone(tz).toISODate();
      if (!key) continue;
      harvestByDay.set(key, (harvestByDay.get(key) || 0) + 1);
    }

    let harvestCount = 0;
    for (const cell of weekGrid) {
      const c = cell.date ? harvestByDay.get(cell.date) || 0 : 0;
      cell.harvestCount = c;
      harvestCount += c;
    }

    const percentage =
      totalSlots === 0 ? 0 : Math.min(100, Math.round((Math.min(harvestCount, totalSlots) / totalSlots) * 100));

    const layerMap = new Map<string, number>();
    for (const g of inScope) {
      const k = String(g.conquestType || 'Outros');
      layerMap.set(k, (layerMap.get(k) || 0) + 1);
    }
    const gardenLayers = Array.from(layerMap.entries()).map(([conquestType, goalCount]) => ({
      conquestType,
      goalCount,
    }));

    return {
      date: datePart,
      areaId: area ?? null,
      weekStart: monday.toISODate(),
      weekEnd: sundayEnd.toISODate(),
      weekGrid,
      weeklyProgress: { percentage, total: totalSlots, harvested: harvestCount },
      harvestCount,
      gardenLayers,
    };
  }

  async getDashboardMonth(userId: string, dateOrMonth: string, areaId?: string) {
    const area = areaId && String(areaId).trim() ? String(areaId).trim() : undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone && String(user.timezone).trim() ? user.timezone : 'America/Sao_Paulo';

    const parsed = monthRangeFromInput(dateOrMonth, tz);
    if (!parsed) {
      return {
        month: String(dateOrMonth || '').slice(0, 7) || null,
        areaId: area ?? null,
        monthStart: null,
        monthEnd: null,
        monthGrid: [],
        monthlyGoal: { percentage: 0, total: 0, harvested: 0 },
        activeDays: 0,
        monthHighlights: [],
      };
    }

    const { monthStart, monthEnd, nextMonthStart, yearMonth } = parsed;
    const daysInMonth = monthStart.daysInMonth ?? 31;

    const goals = await this.userGoalService.getGoalsForUser(userId);
    const inScope = goals.filter((g: any) => {
      if (g.completed) return false;
      const st = g.status ?? 'ACTIVE';
      if (st !== 'ACTIVE') return false;
      if (area && String(g.conquestType) !== area) return false;
      return true;
    });

    type DayCell = {
      date: string | null;
      expectedSlots: number;
      harvestCount: number;
      goals: { id: string; title: string; conquestType: string; slots: number }[];
    };

    const monthGrid: DayCell[] = [];
    let totalSlots = 0;

    for (let i = 0; i < daysInMonth; i++) {
      const d = monthStart.plus({ days: i });
      const dayGoals: DayCell['goals'] = [];
      let expectedSlots = 0;
      for (const g of inScope) {
        const n = expectedSlotCountForGoalOnDate(g, d, tz);
        if (n > 0) {
          expectedSlots += n;
          dayGoals.push({
            id: g.id,
            title: g.title,
            conquestType: g.conquestType,
            slots: n,
          });
        }
      }
      totalSlots += expectedSlots;
      monthGrid.push({
        date: d.toISODate(),
        expectedSlots,
        harvestCount: 0,
        goals: dayGoals,
      });
    }

    const growthEvents = await prisma.growthEvent.findMany({
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
      select: {
        createdAt: true,
        plantedTree: {
          select: {
            goal: { select: { id: true, title: true } },
          },
        },
      },
    });

    const harvestByDay = new Map<string, number>();
    const harvestByGoal = new Map<string, { title: string; count: number }>();

    for (const ev of growthEvents) {
      const key = DateTime.fromJSDate(ev.createdAt).setZone(tz).toISODate();
      if (key) harvestByDay.set(key, (harvestByDay.get(key) || 0) + 1);

      const gid = ev.plantedTree?.goal?.id;
      const title = ev.plantedTree?.goal?.title;
      if (gid) {
        const prev = harvestByGoal.get(gid) || { title: title || '', count: 0 };
        prev.count += 1;
        if (title) prev.title = title;
        harvestByGoal.set(gid, prev);
      }
    }

    let harvestCount = 0;
    let activeDays = 0;
    for (const cell of monthGrid) {
      const c = cell.date ? harvestByDay.get(cell.date) || 0 : 0;
      cell.harvestCount = c;
      harvestCount += c;
      if (c > 0) activeDays += 1;
    }

    const percentage =
      totalSlots === 0 ? 0 : Math.min(100, Math.round((Math.min(harvestCount, totalSlots) / totalSlots) * 100));

    const monthHighlights = Array.from(harvestByGoal.entries())
      .map(([goalId, { title, count }]) => ({ goalId, title, harvestCount: count }))
      .sort((a, b) => b.harvestCount - a.harvestCount)
      .slice(0, 5);

    return {
      month: yearMonth,
      areaId: area ?? null,
      monthStart: monthStart.toISODate(),
      monthEnd: monthEnd.toISODate(),
      monthGrid,
      monthlyGoal: { percentage, total: totalSlots, harvested: harvestCount },
      activeDays,
      monthHighlights,
    };
  }
}
