import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  REMINDER_KINDS,
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
  ReminderPolicyDecision,
  ReminderPolicyInput,
} from '../reminder.types';
import type { ScheduleConfig } from '../../../domain/types/schedule-config.type';
import {
  isOnOrAfterGoalCreationDay,
  hasCompletionOnCalendarDay,
  occurrencesOnCivilDate,
  isOccurrenceDue,
} from '../../shared/schedule-occurrence.util';
import { claimedTimesForCivilDate } from '../claim/claimed-slots.util';
import { makeOccKey } from '../../shared/occurrence-key.util';
import { getGroupLastOperationalAt } from '../grouping/reminder-group.util';
import type { ReminderGroup } from '../grouping/reminder-group.util';

@Injectable()
export class ReminderPolicyEngine {
  private readonly followUp1Minutes = Number(
    process.env.REMINDER_FOLLOW_UP_1_MINUTES || 5,
  );
  private readonly followUp2Minutes = Number(
    process.env.REMINDER_FOLLOW_UP_2_MINUTES || 15,
  );
  private readonly groupFollowUpMinutes = Number(
    process.env.REMINDER_GROUP_FOLLOW_UP_MINUTES || 5,
  );
  private readonly groupLastChanceMinutes = Number(
    process.env.REMINDER_GROUP_LAST_CHANCE_MINUTES || 15,
  );
  private readonly dismissCooldownDays = Number(
    process.env.REMINDER_DISMISS_COOLDOWN_DAYS || 7,
  );
  private readonly snoozeMinutes = Number(
    process.env.REMINDER_SNOOZE_MINUTES || 90,
  );

  evaluate(input: ReminderPolicyInput): ReminderPolicyDecision {
    const { goal, now, timezone } = input;
    const status = String(goal.reminder.dailyStatus || '');
    const silenceUntil = this.toDateTime(goal.reminder.silenceUntil, timezone);

    const sc = goal.schedule;
    if (goal.completed || !sc) {
      return this.wait('goal_ineligible');
    }

    const occsToday = occurrencesOnCivilDate(
      {
        createdAt: new Date(goal.createdAt as Date),
        schedule: sc,
      },
      now,
      timezone,
    );
    const nextDueSlot = occsToday.find(
      (occ) =>
        !claimedTimesForCivilDate(goal.reminder.slotsToday, occ.civilDate, {
          lastSentAt: goal.reminder.lastSentAt,
          timezone,
        }).includes(occ.hhmm) && isOccurrenceDue(occ, now),
    );

    if (status === REMINDER_STATUSES.DONE) {
      if (nextDueSlot) {
        return this.sendOperationalWithSlot(
          now,
          makeOccKey(nextDueSlot.civilDate, nextDueSlot.hhmm),
        );
      }
      const doneToday =
        hasCompletionOnCalendarDay(goal, now, timezone) ||
        this.reminderUpdatedToday(goal, now, timezone);
      if (doneToday) {
        return this.wait('already_done_today');
      }
    }

    if (silenceUntil && silenceUntil > now) {
      return this.wait('cooldown_active');
    }

    if (
      (status === REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY ||
        status === REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY) &&
      occsToday.length === 0 &&
      sc
    ) {
      return this.wait('not_scheduled_today');
    }

    if (goal.id && input.cancelledGoalIds?.has(goal.id)) {
      return this.wait('occurrence_cancelled_exception');
    }

    if (status === REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY) {
      if (nextDueSlot) {
        return this.sendOperationalWithSlot(
          now,
          makeOccKey(nextDueSlot.civilDate, nextDueSlot.hhmm),
        );
      }
      return this.evaluateGroupFollowUp(goal, now, timezone, input.group);
    }

    if (status === REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY) {
      if (nextDueSlot) {
        return this.sendOperationalWithSlot(
          now,
          makeOccKey(nextDueSlot.civilDate, nextDueSlot.hhmm),
        );
      }
      return this.evaluateGroupLastChance(goal, now, timezone, input.group);
    }

    return this.evaluateScheduleConfig(goal, sc, now, timezone);
  }

  private evaluateScheduleConfig(
    goal: ReminderGoalRecord,
    sc: ScheduleConfig,
    now: DateTime,
    timezone: string,
  ): ReminderPolicyDecision {
    if (
      !isOnOrAfterGoalCreationDay(
        now.setZone(timezone),
        new Date(goal.createdAt as Date),
        timezone,
      )
    ) {
      return this.wait('before_goal_creation');
    }
    if (sc.type === 'once') {
      const reminderAt = this.toDateTime(sc.at, timezone);
      if (!reminderAt) return this.wait('invalid_schedule');
      const diffSec = now.toUTC().diff(reminderAt.toUTC(), 'seconds').seconds;
      const occs = occurrencesOnCivilDate(
        { createdAt: new Date(goal.createdAt as Date), schedule: sc },
        now,
        timezone,
      );
      const claimed = occs[0]
        ? claimedTimesForCivilDate(goal.reminder.slotsToday, occs[0].civilDate, {
            lastSentAt: goal.reminder.lastSentAt,
            timezone,
          })
        : [];
      if (claimed.length > 0) return this.wait('already_sent');
      if (!goal.reminder.lastSentAt && diffSec >= 0) {
        const slotKey = occs[0]
          ? makeOccKey(occs[0].civilDate, occs[0].hhmm)
          : undefined;
        return slotKey
          ? this.sendOperationalWithSlot(now, slotKey)
          : this.sendOperational(now);
      }
      return this.wait('not_due');
    }

    if (sc.type === 'daily' || sc.type === 'weekly' || sc.type === 'monthly') {
      const userNow = now.setZone(timezone);
      const occs = occurrencesOnCivilDate(
        { createdAt: new Date(goal.createdAt as Date), schedule: sc },
        userNow,
        timezone,
      );
      if (occs.length === 0) {
        return this.wait('not_scheduled_today');
      }
      const civilDate = occs[0].civilDate;
      const slotsSent = claimedTimesForCivilDate(
        goal.reminder.slotsToday,
        civilDate,
        {
          lastSentAt: goal.reminder.lastSentAt,
          timezone,
        },
      );
      for (const occ of occs) {
        if (slotsSent.includes(occ.hhmm)) continue;
        if (!isOccurrenceDue(occ, now)) continue;
        return this.sendOperationalWithSlot(
          now,
          makeOccKey(occ.civilDate, occ.hhmm),
        );
      }
      return this.wait('not_due');
    }

    return this.wait('invalid_schedule');
  }

  private sendOperationalWithSlot(
    now: DateTime,
    slotKey: string,
  ): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      kind: REMINDER_KINDS.OPERATIONAL,
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      silenceUntil: now.plus({ minutes: this.followUp1Minutes }).toJSDate(),
      slotKey,
    };
  }

  resolveSnoozeUntil(_kind: string | undefined, now: DateTime): Date {
    return now.plus({ minutes: this.snoozeMinutes }).toJSDate();
  }

  resolveDismissUntil(_kind: string | undefined, now: DateTime): Date {
    return now.plus({ days: this.dismissCooldownDays }).toJSDate();
  }

  /** Fim do dia civil no timezone do usuário — usado para "não vou conseguir hoje". */
  resolveEndOfDay(timezone: string, now: DateTime = DateTime.now()): Date {
    return now.setZone(timezone).endOf('day').toJSDate();
  }

  private sendOperational(now: DateTime): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      kind: REMINDER_KINDS.OPERATIONAL,
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      silenceUntil: now.plus({ minutes: this.followUp1Minutes }).toJSDate(),
    };
  }

  private lastOperationalOnCivilDate(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
    group?: ReminderGroup,
  ): DateTime | null {
    const lastOp = group
      ? getGroupLastOperationalAt(group, timezone)
      : this.toDateTime(goal.reminder.lastSentAt, timezone);
    if (!lastOp) return null;
    const today = now.setZone(timezone).toISODate();
    if (lastOp.setZone(timezone).toISODate() !== today) return null;
    return lastOp;
  }

  private evaluateGroupFollowUp(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
    group?: ReminderGroup,
  ): ReminderPolicyDecision {
    const lastOp = this.lastOperationalOnCivilDate(goal, now, timezone, group);
    if (!lastOp) return this.wait('follow_up_not_same_civil_date');
    if (group) {
      const followUpDue = lastOp.plus({ minutes: this.groupFollowUpMinutes });
      if (now < followUpDue) {
        return this.wait('group_follow_up_not_due');
      }
      return this.sendFollowUp(now);
    }
    return this.sendFollowUp(now);
  }

  private evaluateGroupLastChance(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
    group?: ReminderGroup,
  ): ReminderPolicyDecision {
    const lastOp = this.lastOperationalOnCivilDate(goal, now, timezone, group);
    if (!lastOp) return this.wait('follow_up_not_same_civil_date');
    if (group) {
      const lastChanceDue = lastOp.plus({
        minutes: this.groupLastChanceMinutes,
      });
      if (now < lastChanceDue) {
        return this.wait('group_last_chance_not_due');
      }
      return this.sendLastChance(now);
    }
    return this.sendLastChance(now);
  }

  private sendFollowUp(now: DateTime): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP,
      reason: 'follow_up_due',
      kind: REMINDER_KINDS.FOLLOW_UP,
      nextStatus: REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
      silenceUntil: now.plus({ minutes: this.followUp2Minutes }).toJSDate(),
    };
  }

  private sendLastChance(now: DateTime): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_LAST_CHANCE,
      reason: 'last_chance_due',
      kind: REMINDER_KINDS.LAST_CHANCE,
      nextStatus: REMINDER_STATUSES.MISSED,
      silenceUntil: null,
    };
  }

  private wait(reason: string): ReminderPolicyDecision {
    return { action: REMINDER_POLICY_ACTIONS.WAIT, reason };
  }

  private reminderUpdatedToday(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
  ): boolean {
    const raw = goal.reminder.updatedAt;
    if (!raw) return false;
    const at = this.toDateTime(raw, timezone);
    return (
      !!at &&
      at.startOf('day').hasSame(now.setZone(timezone).startOf('day'), 'day')
    );
  }

  private toDateTime(
    value: Date | string | null | undefined,
    timezone: string,
  ) {
    if (!value) return null;
    if (value instanceof Date) {
      return DateTime.fromJSDate(value).setZone(timezone);
    }
    const str = String(value).trim();
    const timeOnly = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnly) {
      const hh = parseInt(timeOnly[1], 10);
      const mm = parseInt(timeOnly[2], 10);
      const ss = parseInt(timeOnly[3] || '0', 10);
      return DateTime.now()
        .setZone(timezone)
        .set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
    }
    const iso = DateTime.fromISO(str, { zone: 'utc' });
    if (iso.isValid) return iso.setZone(timezone);
    const jsDate = new Date(str);
    if (Number.isNaN(jsDate.getTime())) return null;
    return DateTime.fromJSDate(jsDate).setZone(timezone);
  }
}
