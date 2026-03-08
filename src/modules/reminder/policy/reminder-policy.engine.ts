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
import type { ScheduleConfig } from '../../ia/conversation/flow.types';
import { getGroupLastOperationalAt } from '../grouping/reminder-group.util';
import type { ReminderGroup } from '../grouping/reminder-group.util';

@Injectable()
export class ReminderPolicyEngine {
  private readonly maxDelaySec = Number(
    process.env.REMINDER_MAX_DELAY_SEC || 120,
  );
  private readonly followUp1Minutes = Number(
    process.env.REMINDER_FOLLOW_UP_1_MINUTES || 5,
  );
  private readonly followUp2Minutes = Number(
    process.env.REMINDER_FOLLOW_UP_2_MINUTES || 15,
  );
  private readonly groupWindowMinutes = Number(
    process.env.REMINDER_GROUP_WINDOW_MINUTES || 60,
  );
  private readonly groupFollowUpMinutes = Number(
    process.env.REMINDER_GROUP_FOLLOW_UP_MINUTES || 5,
  );
  private readonly groupLastChanceMinutes = Number(
    process.env.REMINDER_GROUP_LAST_CHANCE_MINUTES || 15,
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

    const hasSchedule = this.getScheduleConfig(goal);
    const hasLegacyTime = goal.reminderTime;
    if (goal.completed || (!hasSchedule && !hasLegacyTime)) {
      return this.wait('goal_ineligible');
    }

    if (status === REMINDER_STATUSES.DONE) {
      return this.wait('already_done_today');
    }

    if (silenceUntil && silenceUntil > now) {
      return this.wait('cooldown_active');
    }

    if (status === REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY) {
      return this.evaluateGroupFollowUp(goal, now, timezone, input.group);
    }

    if (status === REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY) {
      return this.evaluateGroupLastChance(goal, now, timezone, input.group);
    }

    if (status === REMINDER_STATUSES.WAITING_REACTIVATION_REPLY) {
      return {
        action: REMINDER_POLICY_ACTIONS.SKIP_CYCLE,
        reason: 'reactivation_window_expired',
        nextStatus: REMINDER_STATUSES.REACTIVATION_COOLDOWN,
        silenceUntil: now.plus({ days: this.reactivationCooldownDays }).toJSDate(),
      };
    }

    const sc = this.getScheduleConfig(goal);
    if (sc) {
      return this.evaluateScheduleConfig(goal, sc, now, timezone);
    }

    if (this.isPontual(goal)) {
      return this.evaluatePontual(goal, now, timezone);
    }

    return this.evaluateContinua(goal, now, timezone);
  }

  private getScheduleConfig(goal: ReminderGoalRecord): ScheduleConfig | null {
    const sc = goal.scheduleConfig;
    if (!sc || typeof sc !== 'object') return null;
    const o = sc as Record<string, unknown>;
    if (o.type === 'once' && typeof o.at === 'string') return sc as ScheduleConfig;
    if (o.type === 'daily' && Array.isArray(o.times) && o.times.length > 0) return sc as ScheduleConfig;
    if (o.type === 'weekly' && Array.isArray(o.daysOfWeek) && Array.isArray(o.times) && o.times.length > 0)
      return sc as ScheduleConfig;
    return null;
  }

  private evaluateScheduleConfig(
    goal: ReminderGoalRecord,
    sc: ScheduleConfig,
    now: DateTime,
    timezone: string,
  ): ReminderPolicyDecision {
    if (sc.type === 'once') {
      const reminderAt = this.toDateTime(sc.at, timezone);
      if (!reminderAt) return this.wait('invalid_schedule');
      const diffSec = now.toUTC().diff(reminderAt.toUTC(), 'seconds').seconds;
      if (!goal.lastReminderSentAt && diffSec >= 0) {
        return this.sendOperational(now);
      }
      return this.wait('not_due');
    }

    if (sc.type === 'daily' || sc.type === 'weekly') {
      const userNow = now.setZone(timezone);
      if (sc.type === 'daily' && sc.durationDays) {
        const createdAt = this.toDateTime(goal.createdAt, timezone);
        if (createdAt) {
          const daysSinceCreation = Math.floor(userNow.diff(createdAt, 'days').days);
          if (daysSinceCreation >= sc.durationDays) {
            return this.wait('duration_ended');
          }
        }
      }
      const todayDow = userNow.weekday === 7 ? 0 : userNow.weekday; // 0=Dom, 1=Seg..6=Sab
      if (sc.type === 'weekly' && !sc.daysOfWeek.includes(todayDow)) {
        return this.wait('not_scheduled_today');
      }

      const slotsSent = this.getSlotsSentToday(goal);
      for (const timeStr of sc.times) {
        const [hh, mm] = timeStr.split(':').map(Number);
        const scheduled = userNow.set({ hour: hh || 0, minute: mm || 0, second: 0, millisecond: 0 });
        const diffSec = now.toUTC().diff(scheduled.toUTC(), 'seconds').seconds;
        const slotKey = timeStr;
        if (diffSec >= 0 && diffSec <= this.maxDelaySec && !slotsSent.includes(slotKey)) {
          if (this.shouldReactivate(goal, now, timezone)) {
            return {
              action: REMINDER_POLICY_ACTIONS.SEND_REACTIVATION,
              reason: 'reactivation_due',
              kind: REMINDER_KINDS.REACTIVATION,
              nextStatus: REMINDER_STATUSES.WAITING_REACTIVATION_REPLY,
              silenceUntil: now.plus({ hours: 24 }).toJSDate(),
            };
          }
          return this.sendOperationalWithSlot(now, slotKey);
        }
      }
      return this.wait('not_due');
    }

    return this.wait('invalid_schedule');
  }

  private getSlotsSentToday(goal: ReminderGoalRecord): string[] {
    const slots = goal.reminderSlotsToday;
    if (!Array.isArray(slots)) return [];
    return slots
      .filter((s): s is { time: string } => s && typeof s === 'object' && typeof (s as any).time === 'string')
      .map((s) => s.time);
  }

  private sendOperationalWithSlot(now: DateTime, slotKey: string): ReminderPolicyDecision {
    return {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      kind: REMINDER_KINDS.OPERATIONAL,
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      silenceUntil: now.plus({ minutes: this.followUp1Minutes }).toJSDate(),
      slotKey, // usado pelo ReminderService para atualizar reminderSlotsToday
    };
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

  /** Fim do dia no timezone do usuário — usado para "não vou conseguir hoje". */
  resolveEndOfDay(timezone: string): Date {
    return DateTime.now().setZone(timezone).endOf('day').toJSDate();
  }

  private evaluatePontual(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
  ): ReminderPolicyDecision {
    const reminderAt = this.toDateTime(goal.reminderTime, timezone);
    if (!reminderAt) return this.wait('invalid_reminder_time');

    const diffSec = now.toUTC().diff(reminderAt.toUTC(), 'seconds').seconds;
    if (!goal.lastReminderSentAt && diffSec >= 0) {
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
      silenceUntil: now.plus({ minutes: this.followUp1Minutes }).toJSDate(),
    };
  }

  private evaluateGroupFollowUp(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
    group?: ReminderGroup,
  ): ReminderPolicyDecision {
    if (!group) {
      return this.sendFollowUp(now);
    }
    const lastOp = getGroupLastOperationalAt(group, timezone);
    if (!lastOp) return this.wait('group_no_operational_yet');
    const followUpDue = lastOp.plus({ minutes: this.groupFollowUpMinutes });
    if (now < followUpDue) {
      return this.wait('group_follow_up_not_due');
    }
    return this.sendFollowUp(now);
  }

  private evaluateGroupLastChance(
    goal: ReminderGoalRecord,
    now: DateTime,
    timezone: string,
    group?: ReminderGroup,
  ): ReminderPolicyDecision {
    if (!group) {
      return this.sendLastChance(now);
    }
    const followUpSentAt = getGroupLastOperationalAt(group, timezone);
    if (!followUpSentAt) return this.sendLastChance(now);
    const lastChanceDue = followUpSentAt.plus({ minutes: this.groupLastChanceMinutes });
    if (now < lastChanceDue) {
      return this.wait('group_last_chance_not_due');
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
