/**
 * Conversão de scheduleConfig/reminderTime → campos persistidos em GoalSchedule.
 *
 * Função pura (sem I/O): recebe a configuração de agendamento de uma meta
 * e devolve os campos no formato esperado pelo schema do banco.
 *
 * Extraído de UserGoalService para que possa ser testado isoladamente
 * e reutilizado por qualquer módulo sem depender do serviço de goals.
 */
import { DateTime } from 'luxon';
import type { ScheduleConfig } from '../../domain/types/schedule-config.type';
import { normalizeGoalType } from '../ia/goal-type.util';
import { coerceScheduleConfig } from './schedule-occurrence.util';
import { normalizeDaysOfWeekJson } from './weekday.util';

const DEFAULT_USER_TIMEZONE = 'America/Sao_Paulo';

export type ResolvedScheduleFields = {
  scheduleFrequency: string | null;
  scheduleAt: Date | null;
  scheduleTimes: string[] | null;
  scheduleDaysOfWeek: number[] | null;
  scheduleDurationDays: number | null;
  scheduleExtra: Record<string, unknown> | null;
};

/** Converte scheduleConfig/reminderTime para campos persistidos em GoalSchedule. */
export function resolveScheduleFields(params: {
  scheduleConfig?: ScheduleConfig | unknown;
  reminderTime?: Date | string;
  goalType: string;
  userTimezone: string;
}): ResolvedScheduleFields {
  const { reminderTime, goalType, userTimezone } = params;
  const normalizedGoalType = normalizeGoalType(goalType) ?? 'Pontual';
  const zone = userTimezone || DEFAULT_USER_TIMEZONE;
  const nowLocal = DateTime.now().setZone(zone);
  const sc = coerceScheduleConfig(params.scheduleConfig, {
    reminderTime,
    goalType: normalizedGoalType,
  });

  let scheduleFrequency: string | null = null;
  let scheduleAt: Date | null = null;
  let scheduleTimes: string[] | null = null;
  let scheduleDaysOfWeek: number[] | null = null;
  let scheduleDurationDays: number | null = null;
  let scheduleExtra: Record<string, unknown> | null = null;

  const parseTimeOnlyToDate = (
    hh: number,
    mm: number,
    ss: number,
    bumpIfPast: boolean,
  ) => {
    let dt = nowLocal.set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
    if (bumpIfPast && dt <= nowLocal) {
      dt = dt.plus({ days: 1 });
    }
    return dt.toUTC().toJSDate();
  };

  if (sc && typeof sc === 'object') {
    if (sc.type === 'once' && sc.at) {
      scheduleFrequency = 'ONCE';
      const atStr = String(sc.at).trim();
      const timeOnly = atStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (timeOnly) {
        scheduleAt = parseTimeOnlyToDate(
          parseInt(timeOnly[1], 10),
          parseInt(timeOnly[2], 10),
          parseInt(timeOnly[3] || '0', 10),
          true,
        );
      } else {
        let dt = DateTime.fromISO(atStr, { zone });
        if (!dt.isValid) dt = DateTime.fromISO(atStr, { zone: 'utc' });
        if (dt.isValid) {
          if (dt <= nowLocal) dt = dt.plus({ days: 1 });
          scheduleAt = dt.toUTC().toJSDate();
        } else {
          scheduleAt = new Date(atStr);
        }
      }
    } else if (
      sc.type === 'daily' &&
      Array.isArray(sc.times) &&
      sc.times.length > 0
    ) {
      scheduleFrequency = 'DAILY';
      scheduleTimes = sc.times.map((t) => String(t).trim());
      scheduleDurationDays = sc.durationDays ?? null;
    } else if (
      sc.type === 'weekly' &&
      Array.isArray(sc.daysOfWeek) &&
      Array.isArray(sc.times) &&
      sc.times.length > 0
    ) {
      scheduleFrequency = 'WEEKLY';
      scheduleTimes = sc.times.map((t) => String(t).trim());
      scheduleDaysOfWeek = normalizeDaysOfWeekJson(sc.daysOfWeek);
    } else if (
      sc.type === 'monthly' &&
      Array.isArray(sc.times) &&
      sc.times.length > 0
    ) {
      const rawDom = sc.dayOfMonth;
      const dom =
        typeof rawDom === 'number'
          ? Math.trunc(rawDom)
          : parseInt(String(rawDom), 10);
      if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
        scheduleFrequency = 'MONTHLY';
        scheduleTimes = sc.times.map((t) => String(t).trim());
        scheduleExtra = { dayOfMonth: dom };
      }
    }
  }

  if (!scheduleFrequency && reminderTime) {
    scheduleFrequency = normalizedGoalType === 'Pontual' ? 'ONCE' : 'DAILY';
    try {
      if (typeof reminderTime === 'string') {
        const s = reminderTime.trim();
        const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (timeOnly) {
          const hh = parseInt(timeOnly[1], 10);
          const mm = parseInt(timeOnly[2], 10);
          const ss = parseInt(timeOnly[3] || '0', 10);
          const dt = parseTimeOnlyToDate(hh, mm, ss, true);
          if (scheduleFrequency === 'ONCE') scheduleAt = dt;
          else
            scheduleTimes = [
              `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
            ];
        } else {
          let dt = DateTime.fromISO(s, { zone });
          if (!dt.isValid) dt = DateTime.fromISO(s, { zone: 'utc' });
          if (dt.isValid) {
            if (scheduleFrequency === 'ONCE') {
              if (dt <= nowLocal) dt = dt.plus({ days: 1 });
              scheduleAt = dt.toUTC().toJSDate();
            } else {
              scheduleTimes = [
                `${String(dt.setZone(zone).hour).padStart(2, '0')}:${String(dt.setZone(zone).minute).padStart(2, '0')}`,
              ];
            }
          }
        }
      } else if (reminderTime instanceof Date) {
        const dt = DateTime.fromJSDate(reminderTime).setZone(zone);
        if (scheduleFrequency === 'ONCE') {
          let at = dt;
          if (at <= nowLocal) at = at.plus({ days: 1 });
          scheduleAt = at.toUTC().toJSDate();
        } else {
          scheduleTimes = [
            `${String(dt.hour).padStart(2, '0')}:${String(dt.minute).padStart(2, '0')}`,
          ];
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    scheduleFrequency,
    scheduleAt,
    scheduleTimes,
    scheduleDaysOfWeek,
    scheduleDurationDays,
    scheduleExtra,
  };
}
