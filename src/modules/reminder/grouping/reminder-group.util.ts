import { DateTime } from 'luxon';
import type { ScheduleConfig } from '../../ia/conversation/flow.types';
import type { ReminderGoalRecord } from '../reminder.types';
import { luxonWeekdayToJsDayOfWeek, normalizeDaysOfWeekJson } from '../../shared/weekday.util';
import { isOnOrAfterGoalCreationDay, getCancelledExceptionsForDate } from '../../shared/schedule-occurrence.util';

export interface ReminderGroup {
  goals: ReminderGoalRecord[];
  firstScheduledAt: DateTime;
  lastScheduledAt: DateTime;
  groupFollowUpAt: DateTime;
  groupLastChanceAt: DateTime;
}

/**
 * Retorna o momento do último operacional enviado no grupo (max de lastReminderSentAt).
 */
export function getGroupLastOperationalAt(group: ReminderGroup, timezone: string): DateTime | null {
  let latest: DateTime | null = null;
  for (const g of group.goals) {
    const sent = g.lastReminderSentAt;
    if (!sent) continue;
    const dt = DateTime.fromJSDate(new Date(sent)).setZone(timezone);
    if (!latest || dt > latest) latest = dt;
  }
  return latest;
}

/**
 * Retorna o horário agendado da meta para hoje (próximo slot não enviado).
 * Para metas com múltiplos slots, retorna o primeiro slot ainda não enviado.
 */
export function getScheduledTimeToday(
  goal: ReminderGoalRecord,
  timezone: string,
): DateTime | null {
  const now = DateTime.now().setZone(timezone);
  const todayStart = now.startOf('day');
  const todayDow = luxonWeekdayToJsDayOfWeek(now.weekday);

  const slotsSent = getSlotsSentToday(goal);

  const sc = goal.scheduleConfig as ScheduleConfig | null;
  if (sc && typeof sc === 'object') {
    if (!isOnOrAfterGoalCreationDay(now, goal.createdAt, timezone)) return null;
    if (sc.type === 'once') {
      const at = new Date(sc.at);
      const userAt = DateTime.fromJSDate(at).setZone(timezone);
      if (!userAt.hasSame(todayStart, 'day')) return null;
      return userAt;
    }
    if (sc.type === 'daily' || sc.type === 'weekly' || sc.type === 'monthly') {
      if (sc.type === 'weekly' && !normalizeDaysOfWeekJson(sc.daysOfWeek).includes(todayDow)) return null;
      if (sc.type === 'monthly') {
        const dom =
          typeof sc.dayOfMonth === 'number' ? Math.trunc(sc.dayOfMonth) : parseInt(String(sc.dayOfMonth), 10);
        if (!Number.isFinite(dom) || todayStart.day !== dom) return null;
      }
      if (sc.type === 'daily' && sc.durationDays) {
        const createdAt = DateTime.fromJSDate(new Date(goal.createdAt)).setZone(timezone);
        const daysSince = Math.floor(now.diff(createdAt, 'days').days);
        if (daysSince >= sc.durationDays) return null;
      }
      for (const timeStr of sc.times) {
        const [hh, mm] = timeStr.split(':').map(Number);
        const scheduled = todayStart.set({ hour: hh || 0, minute: mm || 0, second: 0, millisecond: 0 });
        if (!slotsSent.includes(timeStr)) return scheduled;
      }
      return null;
    }
  }

  if (goal.reminderTime) {
    if (!isOnOrAfterGoalCreationDay(now, goal.createdAt, timezone)) return null;
    const rt = DateTime.fromJSDate(new Date(goal.reminderTime)).setZone(timezone);
    const scheduledToday = todayStart.set({
      hour: rt.hour,
      minute: rt.minute,
      second: 0,
      millisecond: 0,
    });
    return scheduledToday;
  }

  return null;
}

function getSlotsSentToday(goal: ReminderGoalRecord): string[] {
  const slots = goal.reminderSlotsToday;
  if (!Array.isArray(slots)) return [];
  return slots
    .filter((s): s is { time: string } => s != null && typeof s === 'object' && typeof (s as any).time === 'string')
    .map((s) => s.time);
}

/**
 * Filtra metas que têm lembretes agendados para hoje.
 * Verifica exceções de cancelamento (GoalOccurrenceException) para não mostrar metas puladas.
 */
export async function filterGoalsForToday(
  goals: ReminderGoalRecord[],
  timezone: string,
): Promise<ReminderGoalRecord[]> {
  const now = DateTime.now().setZone(timezone);
  const todayDow = luxonWeekdayToJsDayOfWeek(now.weekday);
  const todayStart = now.startOf('day');

  // Buscar exceções canceladas para os goals filtrados
  const goalIds = goals.map((g) => g.id).filter((id): id is string => !!id);
  const cancelledGoalIds = await getCancelledExceptionsForDate(goalIds, now, timezone);

  return goals.filter((g) => {
    // Verificar se esta meta foi pulada (tem exceção de cancelamento para hoje)
    if (g.id && cancelledGoalIds.has(g.id)) return false;

    if (g.completed) return false;
    if (!isOnOrAfterGoalCreationDay(now, g.createdAt, timezone)) return false;
    const sc = g.scheduleConfig as ScheduleConfig | null;
    if (sc && typeof sc === 'object') {
      if (sc.type === 'once') {
        const at = new Date(sc.at);
        const userAt = DateTime.fromJSDate(at).setZone(timezone);
        return userAt.hasSame(todayStart, 'day');
      }
      if (sc.type === 'daily') {
        if (sc.durationDays) {
          const createdAt = DateTime.fromJSDate(new Date(g.createdAt)).setZone(timezone);
          const daysSince = Math.floor(now.diff(createdAt, 'days').days);
          return daysSince < sc.durationDays;
        }
        return true;
      }
      if (sc.type === 'weekly') {
        return normalizeDaysOfWeekJson(sc.daysOfWeek).includes(todayDow);
      }
      if (sc.type === 'monthly') {
        const dom =
          typeof sc.dayOfMonth === 'number' ? Math.trunc(sc.dayOfMonth) : parseInt(String(sc.dayOfMonth), 10);
        return Number.isFinite(dom) && todayStart.day === dom;
      }
    }
    if (g.reminderTime) return true;
    return false;
  });
}

/**
 * Agrupa metas por janela de tempo. Metas cujos horários agendados caem
 * dentro de windowMinutes formam o mesmo grupo.
 */
export function clusterGoalsIntoGroups(
  goals: ReminderGoalRecord[],
  timezone: string,
  windowMinutes: number,
  followUpMinutes: number,
  lastChanceMinutes: number,
): ReminderGroup[] {
  const withTime = goals
    .map((g) => ({ goal: g, at: getScheduledTimeToday(g, timezone) }))
    .filter((x): x is { goal: ReminderGoalRecord; at: DateTime } => x.at != null);

  if (withTime.length === 0) return [];

  withTime.sort((a, b) => a.at.toMillis() - b.at.toMillis());

  const groups: ReminderGroup[] = [];
  let current: ReminderGoalRecord[] = [withTime[0].goal];
  let firstAt = withTime[0].at;
  let lastAt = withTime[0].at;

  for (let i = 1; i < withTime.length; i++) {
    const prev = withTime[i - 1].at;
    const curr = withTime[i].at;
    const diffMin = curr.diff(prev, 'minutes').minutes;

    if (diffMin <= windowMinutes) {
      current.push(withTime[i].goal);
      lastAt = curr;
    } else {
      groups.push(buildGroup(current, firstAt, lastAt, followUpMinutes, lastChanceMinutes));
      current = [withTime[i].goal];
      firstAt = curr;
      lastAt = curr;
    }
  }
  groups.push(buildGroup(current, firstAt, lastAt, followUpMinutes, lastChanceMinutes));

  return groups;
}

function buildGroup(
  goals: ReminderGoalRecord[],
  firstAt: DateTime,
  lastAt: DateTime,
  followUpMinutes: number,
  lastChanceMinutes: number,
): ReminderGroup {
  const groupFollowUpAt = lastAt.plus({ minutes: followUpMinutes });
  const groupLastChanceAt = groupFollowUpAt.plus({ minutes: lastChanceMinutes });
  return {
    goals,
    firstScheduledAt: firstAt,
    lastScheduledAt: lastAt,
    groupFollowUpAt,
    groupLastChanceAt,
  };
}
