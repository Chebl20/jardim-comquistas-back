import { DateTime } from 'luxon';
import type { ScheduleConfig } from '../ia/conversation/flow.types';
import { luxonWeekdayToJsDayOfWeek, normalizeDaysOfWeekJson } from './weekday.util';
import { prisma } from '../../prisma/client';

type GoalLike = {
  id?: string;
  createdAt: Date;
  scheduleConfig?: ScheduleConfig | null;
};

/**
 * Busca exceções canceladas (isCancelled=true) para um conjunto de goals em uma data específica.
 * Retorna um Set de goalIds que têm exceções de cancelamento para a data.
 */
export async function getCancelledExceptionsForDate(
  goalIds: string[],
  targetDate: DateTime,
  timezone: string,
): Promise<Set<string>> {
  if (goalIds.length === 0) return new Set();

  const targetStart = targetDate.setZone(timezone).startOf('day');
  const targetEnd = targetDate.setZone(timezone).endOf('day');

  const exceptions = await prisma.goalOccurrenceException.findMany({
    where: {
      goalId: { in: goalIds },
      isCancelled: true,
      originalOccurrenceStart: {
        gte: targetStart.toJSDate(),
        lte: targetEnd.toJSDate(),
      },
    },
    select: { goalId: true },
  });

  return new Set(exceptions.map((e) => e.goalId));
}

/**
 * Verifica se um goal específico tem exceção de cancelamento para uma data.
 */
export async function hasCancelledExceptionForDate(
  goalId: string,
  targetDate: DateTime,
  timezone: string,
): Promise<boolean> {
  const cancelled = await getCancelledExceptionsForDate([goalId], targetDate, timezone);
  return cancelled.has(goalId);
}

/** `day` é o mesmo dia civil ou posterior ao dia em que a meta foi criada (fuso `tz`). */
export function isOnOrAfterGoalCreationDay(day: DateTime, createdAt: Date | string, tz: string): boolean {
  const dayStart = day.setZone(tz).startOf('day');
  const createdDay = DateTime.fromJSDate(new Date(createdAt)).setZone(tz).startOf('day');
  return dayStart >= createdDay;
}

/**
 * Quantidade de "slots" esperados para a meta em um dia civil no fuso `tz`
 * (ex.: weekly ter/qui com 1 horário → 1; daily com 2 horários → 2).
 */
export function expectedSlotCountForGoalOnDate(goal: GoalLike, day: DateTime, tz: string): number {
  const sc = goal.scheduleConfig;
  if (!sc || typeof sc !== 'object') return 0;
  if (!isOnOrAfterGoalCreationDay(day, goal.createdAt, tz)) return 0;
  const dayStart = day.setZone(tz).startOf('day');

  if (sc.type === 'once') {
    const userAt = DateTime.fromJSDate(new Date(sc.at)).setZone(tz);
    return userAt.hasSame(dayStart, 'day') ? 1 : 0;
  }

  if (sc.type === 'daily') {
    if (sc.durationDays) {
      const createdAt = DateTime.fromJSDate(new Date(goal.createdAt)).setZone(tz);
      const daysSince = Math.floor(dayStart.diff(createdAt, 'days').days);
      if (daysSince >= sc.durationDays) return 0;
    }
    return Array.isArray(sc.times) && sc.times.length > 0 ? sc.times.length : 0;
  }

  if (sc.type === 'weekly') {
    const dow = luxonWeekdayToJsDayOfWeek(day.setZone(tz).weekday);
    if (!normalizeDaysOfWeekJson(sc.daysOfWeek).includes(dow)) return 0;
    return Array.isArray(sc.times) && sc.times.length > 0 ? sc.times.length : 0;
  }

  if (sc.type === 'monthly') {
    const dom = typeof sc.dayOfMonth === 'number' ? Math.trunc(sc.dayOfMonth) : NaN;
    if (!Number.isFinite(dom) || dom < 1 || dom > 31) return 0;
    if (dayStart.day !== dom) return 0;
    return Array.isArray(sc.times) && sc.times.length > 0 ? sc.times.length : 0;
  }

  return 0;
}

/**
 * Semana que contém `anchor`: segunda 00:00 até domingo 23:59:59 no fuso `tz`.
 * `nextMonday` (exclusivo) facilita queries `createdAt < nextMonday`.
 */
export function weekRangeContainingDate(
  anchor: DateTime,
  tz: string,
): { monday: DateTime; sundayEnd: DateTime; nextMonday: DateTime } {
  const monday = anchor.setZone(tz).set({ weekday: 1 }).startOf('day');
  const nextMonday = monday.plus({ weeks: 1 });
  const sundayEnd = monday.plus({ days: 6 }).endOf('day');
  return { monday, sundayEnd, nextMonday };
}

/**
 * Interpreta `date` ou `YYYY-MM` no fuso `tz` e devolve o intervalo do mês civil
 * (início do 1º dia → exclusivo do 1º dia do mês seguinte, para queries UTC).
 */
export function monthRangeFromInput(
  input: string,
  tz: string,
): { monthStart: DateTime; monthEnd: DateTime; nextMonthStart: DateTime; yearMonth: string } | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let anchor: DateTime;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    anchor = DateTime.fromISO(raw.slice(0, 10), { zone: tz });
  } else if (/^\d{4}-\d{2}$/.test(raw.slice(0, 7))) {
    anchor = DateTime.fromISO(`${raw.slice(0, 7)}-01`, { zone: tz });
  } else {
    return null;
  }

  if (!anchor.isValid) return null;

  const monthStart = anchor.startOf('month');
  const monthEnd = anchor.endOf('month');
  const nextMonthStart = monthStart.plus({ months: 1 });
  const yearMonth = monthStart.toFormat('yyyy-LL');

  return { monthStart, monthEnd, nextMonthStart, yearMonth };
}
