/**
 * Pure domain helpers for goal-creation flow.
 * No I/O, no NestJS decorators — fully unit-testable in isolation.
 */
import { DateTime } from 'luxon';
import {
  DraftGoalPayload,
  ValidatedGoalPayload,
  ScheduleConfig,
} from '../../conversation/flow.types';
import { coerceScheduleConfig } from '../../../shared/schedule-occurrence.util';
import { isValidScheduleConfig } from '../../../../domain/types/schedule-config.type';
import { normalizeConquestType } from '../../conquest-type.enum';
import { normalizeGoalType } from '../../goal-type.util';

/**
 * Converte offsets relativos como "+15min", "+1h", "+1h30min" para ISO 8601 absoluto.
 * Formatos aceitos como passthrough: "HH:MM" e strings ISO válidas.
 * Retorna null se o valor for irreconhecível.
 */
export function resolveReminderTime(
  value: string | null | undefined,
  now: Date,
  timezone = 'America/Sao_Paulo',
): string | null {
  if (!value) return null;

  // HH:MM — passthrough; UserGoalService converte para o dia certo
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) return value;

  const base = DateTime.fromJSDate(now).setZone(timezone);

  // ISO válido — passthrough
  const iso = DateTime.fromISO(value, { zone: timezone });
  if (iso.isValid) return iso.toUTC().toISO();

  // +Xmin
  const minMatch = value.match(/^\+(\d+)\s*min$/i);
  if (minMatch) {
    return base
      .plus({ minutes: parseInt(minMatch[1], 10) })
      .toUTC()
      .toISO()!;
  }

  // +Xh (sem minutos)
  const hMatch = value.match(/^\+(\d+)\s*h$/i);
  if (hMatch) {
    return base
      .plus({ hours: parseInt(hMatch[1], 10) })
      .toUTC()
      .toISO()!;
  }

  // +XhYmin
  const hMinMatch = value.match(/^\+(\d+)\s*h\s*(\d+)\s*min$/i);
  if (hMinMatch) {
    return base
      .plus({
        hours: parseInt(hMinMatch[1], 10),
        minutes: parseInt(hMinMatch[2], 10),
      })
      .toUTC()
      .toISO()!;
  }

  return null;
}

export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeFrequency(
  value: DraftGoalPayload['frequency'],
): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value === 'string') {
    const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

export type GoalPayloadGuardResult =
  | {
      ok: true;
      payload: ValidatedGoalPayload;
    }
  | {
      ok: false;
      reply: string;
      continuePayload: DraftGoalPayload;
    };

export function parseTimeFromISO(
  iso: string,
  timezone = 'America/Sao_Paulo',
): string {
  const dt = DateTime.fromISO(iso, { zone: timezone });
  if (dt.isValid) {
    return dt.setZone(timezone).toFormat('HH:mm');
  }
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return DateTime.fromJSDate(d).setZone(timezone).toFormat('HH:mm');
  }
  return iso;
}

export function buildScheduleFromReminderTime(
  reminderTime: string,
  goalType: string,
  timezone = 'America/Sao_Paulo',
): ScheduleConfig {
  const isPontual = normalizeGoalType(goalType) === 'Pontual';
  if (isPontual) {
    return { type: 'once', at: reminderTime };
  }
  const timeStr = reminderTime.includes('T')
    ? parseTimeFromISO(reminderTime, timezone)
    : reminderTime;
  return { type: 'daily', times: [timeStr] };
}

/**
 * Detecta se o payload está removendo dias de uma schedule semanal existente,
 * sinalizando possível confusão entre "skip today" vs "remove this day permanently".
 */
export function detectSuspiciousScheduleReduction(
  meta: Record<string, unknown>,
  newSchedule: unknown,
): boolean {
  const prevSchedule = meta.scheduleConfig as any;
  if (!prevSchedule || prevSchedule.type !== 'weekly') return false;

  const newSc = newSchedule as any;
  if (!newSc || newSc.type !== 'weekly') return false;

  const prevDays = (
    Array.isArray(prevSchedule.daysOfWeek) ? prevSchedule.daysOfWeek : []
  ) as number[];
  const newDays = (
    Array.isArray(newSc.daysOfWeek) ? newSc.daysOfWeek : []
  ) as number[];

  const removedDays = prevDays.filter((d) => !newDays.includes(d));
  return removedDays.length > 0;
}

export function sanitizeGoalPayload(
  draft: DraftGoalPayload,
  now: Date,
  meta?: Record<string, unknown>,
): GoalPayloadGuardResult {
  const title = cleanText(draft.title);
  const description = cleanText(draft.description);
  const timeToken = cleanText(draft.timeToken);
  const rawType =
    draft.scheduleConfig && typeof draft.scheduleConfig === 'object'
      ? String(
          (draft.scheduleConfig as { type?: string }).type || '',
        ).toLowerCase()
      : '';
  const looksRecurring =
    ['daily', 'weekly', 'monthly', 'day'].includes(rawType) ||
    !!normalizeFrequency(draft.frequency);
  const normalizedGoalType =
    normalizeGoalType(
      typeof draft.goalType === 'string' ? draft.goalType : undefined,
    ) ??
    (looksRecurring
      ? 'Continua'
      : draft.reminderTime || draft.scheduleConfig || timeToken
        ? 'Pontual'
        : 'Continua');
  const normalizedConquest =
    normalizeConquestType(
      typeof draft.conquestType === 'string' ? draft.conquestType : undefined,
    ) ?? 'Mente';
  const userTimezone =
    typeof meta?.userTimezone === 'string' && meta.userTimezone.trim()
      ? meta.userTimezone.trim()
      : 'America/Sao_Paulo';

  let scheduleConfig: ScheduleConfig | undefined;
  let reminderTime: string | undefined;

  const coercedFromDraft = coerceScheduleConfig(draft.scheduleConfig, {
    reminderTime: cleanText(draft.reminderTime),
    timeToken,
    goalType: normalizedGoalType,
  });

  if (coercedFromDraft && isValidScheduleConfig(coercedFromDraft)) {
    scheduleConfig = coercedFromDraft;
    if (scheduleConfig.type === 'once') reminderTime = scheduleConfig.at;
  } else {
    const rawReminder = cleanText(draft.reminderTime) || timeToken;
    if (rawReminder) {
      const resolved = resolveReminderTime(rawReminder, now, userTimezone);
      if (!resolved) {
        return {
          ok: false,
          reply:
            'Não consegui confirmar o horário desse lembrete. Pode me dizer de novo o horário ou em quanto tempo eu devo te lembrar?',
          continuePayload: {
            ...draft,
            goalType: normalizedGoalType,
            conquestType: normalizedConquest,
            reminderTime: undefined,
          },
        };
      }
      reminderTime = resolved;
      scheduleConfig = buildScheduleFromReminderTime(
        resolved,
        normalizedGoalType,
        userTimezone,
      );
    }
  }

  if (!title) {
    return {
      ok: false,
      reply: 'Qual meta você quer criar exatamente?',
      continuePayload: {
        ...draft,
        goalType: normalizedGoalType,
        conquestType: normalizedConquest,
        reminderTime,
        scheduleConfig,
      },
    };
  }

  if (!scheduleConfig && !reminderTime) {
    return {
      ok: false,
      reply:
        'A que horas você quer que eu te lembre? Pode dizer um horário (ex: 08:00) ou em quanto tempo (ex: daqui 15 min).',
      continuePayload: {
        ...draft,
        title,
        goalType: normalizedGoalType,
        conquestType: normalizedConquest,
      },
    };
  }

  const payload: ValidatedGoalPayload = {
    title,
    description: description ?? 'Primeiro gesto que deu vida ao crescimento',
    goalType: normalizedGoalType,
    conquestType: normalizedConquest,
    timeToken: timeToken ?? null,
  };

  if (reminderTime) payload.reminderTime = reminderTime;
  if (scheduleConfig) payload.scheduleConfig = scheduleConfig;

  if (normalizedGoalType === 'Continua') {
    const frequency = normalizeFrequency(draft.frequency);
    if (frequency) payload.frequency = frequency;
  }

  if (
    meta &&
    scheduleConfig &&
    detectSuspiciousScheduleReduction(meta, scheduleConfig)
  ) {
    return {
      ok: false,
      reply:
        'Percebi que você quis remover um dia da sua agenda. Se era só para hoje não receber lembrete, eu posso pausar por umas horas em vez de remover permanentemente. Quer que eu faça isso?',
      continuePayload: draft,
    };
  }

  return {
    ok: true,
    payload,
  };
}
