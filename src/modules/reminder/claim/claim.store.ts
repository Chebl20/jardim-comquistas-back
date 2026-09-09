import type { DateTime } from 'luxon';
import type {
  ReminderGoalRecord,
  ReminderPolicyDecision,
} from '../reminder.types';

export const REMINDER_CLAIM_STORE = Symbol('REMINDER_CLAIM_STORE');

export type ClaimDispatchItem = {
  goal: ReminderGoalRecord;
  decision: ReminderPolicyDecision;
};

export type ClaimSnapshot = {
  id: string;
  dailyStatus: string | null | undefined;
  lastSentAt: Date | string | null | undefined;
  silenceUntil: Date | string | null | undefined;
  slotsToday: unknown;
  sentCount: number;
};

export interface ReminderClaimStore {
  claimBatch(
    items: ClaimDispatchItem[],
    now: DateTime,
    timezone: string,
  ): Promise<boolean>;
  rollback(snapshots: ClaimSnapshot[]): Promise<void>;
}
