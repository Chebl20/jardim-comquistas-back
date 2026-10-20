import type { ScheduleConfig } from '../../domain/types/schedule-config.type';
import { isValidScheduleConfig } from '../../domain/types/schedule-config.type';
import { coerceScheduleConfig } from '../shared/schedule-occurrence.util';
import { normalizeDaysOfWeekJson } from '../shared/weekday.util';
import {
  visualForConquestType,
  type GardenAccentColor,
} from '../shared/area-visual.util';

import { resolveUserTimezone } from '../shared/app-timezone';
import { parseInstantInTimezone } from '../shared/parse-instant-timezone.util';
import { DateTime } from 'luxon';

export type GoalReminderState = {
  dailyStatus: string | null;
  lastSentAt: Date | string | null;
  slotsToday: unknown;
  silenceUntil: Date | string | null;
  sentCount: number;
  updatedAt: Date | string | null;
};

export type GoalReminderView = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  goalKind: string;
  conquestType: string;
  icon: string;
  accentColor: GardenAccentColor;
  completed: boolean;
  createdAt: Date | string;
  timezone: string;
  schedule: ScheduleConfig | null;
  reminder: GoalReminderState;
  user: {
    id: string;
    name: string;
    telegramId: string | null;
    whatsappId?: string | null;
    preferredChannel?: string | null;
    timezone: string | null;
  } | null;
  plantedTree?: {
    growthEvents?: Array<{
      createdAt: Date | string;
      progressIndex: number;
    }>;
  } | null;
};

type PrismaScheduleRow = {
  frequency?: string | null;
  at?: Date | string | null;
  times?: unknown;
  daysOfWeek?: unknown;
  durationDays?: number | null;
  timeZone?: string | null;
  extra?: unknown;
} | null;

function timesFromPrisma(times: unknown): string[] {
  if (Array.isArray(times)) return times.map((t) => String(t));
  if (typeof times === 'string' && times.trim()) {
    try {
      const parsed = JSON.parse(times);
      if (Array.isArray(parsed)) return parsed.map((t) => String(t));
    } catch {
      return [times];
    }
    return [times];
  }
  return [];
}

function scheduleFromPrismaRow(sc: PrismaScheduleRow): unknown {
  if (!sc) return null;
  const timesJson = timesFromPrisma(sc.times);
  if (sc.frequency === 'ONCE' && sc.at) {
    const tz = resolveUserTimezone(sc.timeZone);
    if (sc.at instanceof Date) {
      const at =
        DateTime.fromJSDate(sc.at, { zone: 'utc' }).toUTC().toISO() ??
        sc.at.toISOString();
      return { type: 'once', at };
    }
    const parsed = parseInstantInTimezone(String(sc.at), tz);
    const at =
      parsed?.isValid && parsed.toISO()
        ? parsed.toISO()!
        : String(sc.at);
    return { type: 'once', at };
  }
  if (sc.frequency === 'DAILY') {
    return {
      type: 'daily',
      times: timesJson,
      ...(sc.durationDays != null ? { durationDays: sc.durationDays } : {}),
    };
  }
  if (sc.frequency === 'WEEKLY') {
    return {
      type: 'weekly',
      times: timesJson,
      daysOfWeek: normalizeDaysOfWeekJson(sc.daysOfWeek),
    };
  }
  if (sc.frequency === 'MONTHLY') {
    const extra =
      sc.extra && typeof sc.extra === 'object'
        ? (sc.extra as Record<string, unknown>)
        : {};
    const raw = extra.dayOfMonth;
    const dom =
      typeof raw === 'number'
        ? Math.trunc(raw)
        : typeof raw === 'string'
          ? parseInt(raw, 10)
          : NaN;
    if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
      return { type: 'monthly', dayOfMonth: dom, times: timesJson };
    }
  }
  return null;
}

export function toGoalReminderView(row: {
  id: string;
  userId?: string;
  title: string;
  description?: string | null;
  goalKind: string;
  conquestType: string;
  completed: boolean;
  createdAt: Date | string;
  schedule?: PrismaScheduleRow;
  reminder?: {
    dailyStatus?: string | null;
    lastSentAt?: Date | string | null;
    slotsToday?: unknown;
    silenceUntil?: Date | string | null;
    sentCount?: number;
    updatedAt?: Date | string | null;
  } | null;
  user?: GoalReminderView['user'];
  plantedTree?: GoalReminderView['plantedTree'];
}): GoalReminderView {
  const reconstructed = scheduleFromPrismaRow(row.schedule ?? null);
  const coerced = coerceScheduleConfig(reconstructed, {
    goalType: row.goalKind,
  });
  const schedule =
    coerced && isValidScheduleConfig(coerced) ? coerced : null;

  const userTz = row.user?.timezone && String(row.user.timezone).trim();
  const scheduleTz =
    row.schedule?.timeZone && String(row.schedule.timeZone).trim();
  const timezone = resolveUserTimezone(userTz || scheduleTz);

  const rem = row.reminder;
  const visual = visualForConquestType(row.conquestType);
  return {
    id: row.id,
    userId: row.userId ?? row.user?.id ?? '',
    title: row.title,
    description: row.description ?? null,
    goalKind: row.goalKind,
    conquestType: row.conquestType,
    icon: visual.icon,
    accentColor: visual.accentColor,
    completed: row.completed,
    createdAt: row.createdAt,
    timezone,
    schedule,
    reminder: {
      dailyStatus: rem?.dailyStatus ?? null,
      lastSentAt: rem?.lastSentAt ?? null,
      slotsToday: rem?.slotsToday ?? [],
      silenceUntil: rem?.silenceUntil ?? null,
      sentCount: rem?.sentCount ?? 0,
      updatedAt: rem?.updatedAt ?? null,
    },
    user: row.user ?? null,
    plantedTree: row.plantedTree ?? null,
  };
}
