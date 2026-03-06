import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  REMINDER_KINDS,
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
  ReminderPolicyDecision,
  ReminderPolicyInput,
} from './reminder.types';

@Injectable()
export class ReminderPolicyEngine {
  private readonly maxDelaySec = Number(
    process.env.REMINDER_MAX_DELAY_SEC || 120,
  );
  private readonly followUpDelayMinutes = Number(
    process.env.REMINDER_FOLLOW_UP_DELAY_MINUTES || 60,
  );
  private readonly reactivationMinGoalAgeDays = Number(
    process.env.REMINDER_REACTIVATION_MIN_GOAL_AGE_DAYS || 14,
  );
  private readonly reactivationMinInactivityDays = Number(
    process.env.REMINDER_REACTIVATION_MIN_INACTIVITY_DAYS || 10,
  );
  private readonly reactivationCooldownDays = Number(
    process.env.REMINDER_REACTIVATION_COOLDOWN_DAYS || 14,
  );
  private readonly dismissCooldownDays = Number(
    process.env.REMINDER_DISMISS_COOLDOWN_DAYS || 7,
  );
  private readonly snoozeMinutes = Number(
    process.env.REMINDER_SNOOZE_MINUTES || 90,
  );

  evaluate(input: ReminderPolicyInput): ReminderPolicyDecision {
    const { goal, now, timezone } = input;
    const status = String(goal.dailyStatus || '');
    const silenceUntil = this.toDateTime(goal.silenceUntil, timezone);

    if (goal.completed || !goal.reminderTime) {
      return this.wait('goal_ineligible');
    }

    if (silenceUntil && silenceUntil > now) {
      return this.wait('cooldown_active');
    }

    if (status === REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY) {
      return this.sendFollowUp(now);
    }

    if (status === REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY) {
      return {
        action: REMINDER_POLICY_ACTIONS.SKIP_CYCLE,
        reason: 'follow_up_exhausted',
        nextStatus: REMINDER_STATUSES.MISSED,
        silenceUntil: null,
      };
    }

    if (status === REMINDER_STATUSES.WAITING_REACTIVATION_REPLY) {
      return {
        action: REMINDER_POLICY_ACTIONS.SKIP_CYCLE,
        reason: 'reactivation_window_expired',
        nextStatus: REMINDER_STATUSES.REACTIVATION_COOLDOWN,
        silenceUntil: now.plus({ days: this.reactivationCooldownDays }).toJSDate(),
      };
    }

    if (this.isPontual(goal)) {
      return this.evaluatePontual(goal, now, timezone);
    }

    return this.evaluateContinua(goal, now, timezone);
  }

  resolveSnoozeUntil(kind: string | undefined, now: DateTime): Date {
    if (kind === REMINDER_KINDS.REACTIVATION) {
      return now.plus({ days: 3 }).toJSDate();
    }
    return now.plus({ minutes: this.snoozeMinutes }).toJSDate();
  }

  resolveDismissUntil(kind: string | undefined, now: DateTime): Date {
    if (kind === REMINDER_KINDS.REACTIVATION) {
      return now.plus({ days: this.reactivationCooldownDays }).toJSDate();
    }
    return now.plus({ days: this.dismissCooldownDays }).toJSDate();
  }

  private evaluatePontual(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
  ): ReminderPolicyDecision {
    const reminderAt = this.toDateTime(goal.reminderTime, timezone);
    if (!reminderAt) return this.wait('invalid_reminder_time');

    const diffSec = now.toUTC().diff(reminderAt.toUTC(), 'seconds').seconds;
    if (!goal.lastReminderSentAt && diffSec >= 0 && diffSec <= this.maxDelaySec) {
      return this.sendOperational(now);
    }

    return this.wait('not_due');
  }

  private evaluateContinua(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
  ): ReminderPolicyDecision {
    const reminderAt = this.toDateTime(goal.reminderTime, timezone);
    if (!reminderAt) return this.wait('invalid_reminder_time');

    const scheduledToday = now
      .setZone(timezone)
      .set({
        hour: reminderAt.setZone(timezone).hour,
        minute: reminderAt.setZone(timezone).minute,
        second: 0,
        millisecond: 0,
      });
    const diffSec = now.toUTC().diff(scheduledToday.toUTC(), 'seconds').seconds;
    const lastSentAt = this.toDateTime(goal.lastReminderSentAt, timezone);
    const sentThisCycle =
      !!lastSentAt &&
      lastSentAt.toUTC() >= scheduledToday.toUTC() &&
      lastSentAt.toUTC() < scheduledToday.plus({ days: 1 }).toUTC();

    if (!sentThisCycle && diffSec >= 0 && diffSec <= this.maxDelaySec) {
      if (this.shouldReactivate(goal, now, timezone)) {
        return {
          action: REMINDER_POLICY_ACTIONS.SEND_REACTIVATION,
          reason: 'reactivation_due',
          kind: REMINDER_KINDS.REACTIVATION,
          nextStatus: REMINDER_STATUSES.WAITING_REACTIVATION_REPLY,
          silenceUntil: now.plus({ hours: 24 }).toJSDate(),
        };
      }

      return this.sendOperational(now);
    }

    return this.wait('not_due');
  }

  private shouldReactivate(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
  ) {
    const createdAt = this.toDateTime(goal.createdAt, timezone);
    if (!createdAt) return false;

    const ageDays = Math.floor(now.diff(createdAt, 'days').days);
    if (ageDays < this.reactivationMinGoalAgeDays) return false;

    const latestProgress = this.resolveLatestProgress(goal, timezone) ?? createdAt;
    const inactivityDays = Math.floor(now.diff(latestProgress, 'days').days);
    if (inactivityDays < this.reactivationMinInactivityDays) return false;

    if (goal.reminderCount >= 3) return true;

    const noRealProgress =
      (goal.plantedTree?.growthEvents?.length ?? 0) <= 1 &&
      ageDays >= this.reactivationMinGoalAgeDays * 2;

    return noRealProgress;
  }

  private resolveLatestProgress(goal: ReminderGoalRecord, timezone: string) {
    const events = Array.isArray(goal.plantedTree?.growthEvents)
      ? goal.plantedTree?.growthEvents ?? []
      : [];

    if (events.length <= 1) return null;

    return this.toDateTime(events[0]?.createdAt, timezone);
  }

  private sendOperational(now: DateTime): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      kind: REMINDER_KINDS.OPERATIONAL,
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      silenceUntil: now.plus({ minutes: this.followUpDelayMinutes }).toJSDate(),
    };
  }

  private sendFollowUp(now: DateTime): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP,
      reason: 'follow_up_due',
      kind: REMINDER_KINDS.FOLLOW_UP,
      nextStatus: REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
      silenceUntil: now.plus({ minutes: this.followUpDelayMinutes }).toJSDate(),
    };
  }

  private wait(reason: string): ReminderPolicyDecision {
    return { action: REMINDER_POLICY_ACTIONS.WAIT, reason };
  }

  private isPontual(goal: ReminderGoalRecord) {
    return String(goal.goalType || '').toLowerCase() === 'pontual';
  }

  private toDateTime(
    value: Date | string | null | undefined,
    timezone: string,
  ) {
    if (!value) return null;
    if (value instanceof Date) {
      return DateTime.fromJSDate(value).setZone(timezone);
    }
    const iso = DateTime.fromISO(String(value), { zone: 'utc' });
    if (iso.isValid) return iso.setZone(timezone);
    const jsDate = new Date(String(value));
    if (Number.isNaN(jsDate.getTime())) return null;
    return DateTime.fromJSDate(jsDate).setZone(timezone);
  }
}
