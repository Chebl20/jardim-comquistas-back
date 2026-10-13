import { DateTime } from 'luxon';
import type { ReminderGoalRecord } from '../reminder.types';
import {
  occurrencesOnCivilDate,
  filterGoalsOnCivilDate,
} from '../../shared/schedule-occurrence.util';
import { claimedTimesForCivilDate } from '../claim/claimed-slots.util';

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
export function getGroupLastOperationalAt(
  group: ReminderGroup,
  timezone: string,
): DateTime | null {
  let latest: DateTime | null = null;
  for (const g of group.goals) {
    const sent = g.reminder.lastSentAt;
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
  now: DateTime = DateTime.now(),
): DateTime | null {
  const occs = occurrencesOnCivilDate(
    {
      createdAt: new Date(goal.createdAt as Date),
      schedule: goal.schedule,
    },
    now,
    timezone,
  );
  if (occs.length === 0) return null;
  const civilDate = occs[0].civilDate;
  const sent = claimedTimesForCivilDate(goal.reminder.slotsToday, civilDate, {
    lastSentAt: goal.reminder.lastSentAt,
    timezone,
  });
  const next = occs.find((o) => !sent.includes(o.hhmm));
  return (next ?? occs[0]).at;
}

/**
 * Filtra metas com ocorrência hoje. `cancelledGoalIds` vem do adapter de exceções.
 */
export function filterGoalsForToday(
  goals: ReminderGoalRecord[],
  timezone: string,
  now: DateTime = DateTime.now(),
  cancelledGoalIds: Set<string> = new Set(),
): ReminderGoalRecord[] {
  const day = now.setZone(timezone);
  return filterGoalsOnCivilDate(goals, day, timezone).filter((g) => {
    if (g.id && cancelledGoalIds.has(g.id)) return false;
    if (g.completed) return false;
    return true;
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
    .filter(
      (x): x is { goal: ReminderGoalRecord; at: DateTime } => x.at != null,
    );

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
      groups.push(
        buildGroup(
          current,
          firstAt,
          lastAt,
          followUpMinutes,
          lastChanceMinutes,
        ),
      );
      current = [withTime[i].goal];
      firstAt = curr;
      lastAt = curr;
    }
  }
  groups.push(
    buildGroup(current, firstAt, lastAt, followUpMinutes, lastChanceMinutes),
  );

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
  const groupLastChanceAt = groupFollowUpAt.plus({
    minutes: lastChanceMinutes,
  });
  return {
    goals,
    firstScheduledAt: firstAt,
    lastScheduledAt: lastAt,
    groupFollowUpAt,
    groupLastChanceAt,
  };
}
