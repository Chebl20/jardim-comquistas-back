import { DateTime } from 'luxon';
import type { ReminderGoalRecord } from '../reminder.types';
import {
  appendClaimedSlot,
  claimedSlotsToJson,
} from './claimed-slots.util';
import { makeOccKey, parseOccKey } from '../../shared/occurrence-key.util';
import type {
  ClaimDispatchItem,
  ClaimSnapshot,
  ReminderClaimStore,
} from './claim.store';

export type ClaimRow = {
  goalId: string;
  dailyStatus: string | null;
  lastSentAt: Date | null;
  silenceUntil: Date | null;
  sentCount: number;
  slotsToday: unknown;
};

function snapshot(row: ClaimRow): ClaimRow {
  return {
    ...row,
    lastSentAt: row.lastSentAt ? new Date(row.lastSentAt) : null,
    silenceUntil: row.silenceUntil ? new Date(row.silenceUntil) : null,
    slotsToday: JSON.parse(JSON.stringify(row.slotsToday ?? [])),
  };
}

function lockMatches(row: ClaimRow, goal: ReminderGoalRecord): boolean {
  const expectedSent = goal.reminder.lastSentAt
    ? new Date(goal.reminder.lastSentAt).getTime()
    : null;
  const actualSent = row.lastSentAt ? row.lastSentAt.getTime() : null;
  if (expectedSent !== actualSent) return false;
  const expectedStatus = goal.reminder.dailyStatus ?? null;
  const actualStatus = row.dailyStatus ?? null;
  return expectedStatus === actualStatus;
}

/** Adapter in-memory do seam ReminderClaimStore (testes). */
export class InMemoryClaimStore implements ReminderClaimStore {
  private rows = new Map<string, ClaimRow>();

  seedFromGoal(goal: ReminderGoalRecord) {
    this.rows.set(goal.id, {
      goalId: goal.id,
      dailyStatus: goal.reminder.dailyStatus ?? null,
      lastSentAt: goal.reminder.lastSentAt
        ? new Date(goal.reminder.lastSentAt)
        : null,
      silenceUntil: goal.reminder.silenceUntil
        ? new Date(goal.reminder.silenceUntil)
        : null,
      sentCount: goal.reminder.sentCount || 0,
      slotsToday: goal.reminder.slotsToday ?? [],
    });
  }

  get(goalId: string): ClaimRow | undefined {
    const row = this.rows.get(goalId);
    return row ? snapshot(row) : undefined;
  }

  async claimBatch(
    items: ClaimDispatchItem[],
    now: DateTime,
    timezone: string,
  ): Promise<boolean> {
    const civilDate = now.setZone(timezone).toISODate() || '';
    const nowJs = now.toJSDate();
    const backups = items.map((i) => snapshot(this.ensure(i.goal)));
    try {
      for (const { goal, decision } of items) {
        const row = this.ensure(goal);
        if (!lockMatches(row, goal)) {
          throw new Error('lock_failed');
        }
        const occKey = decision.slotKey
          ? parseOccKey(decision.slotKey)
            ? decision.slotKey
            : makeOccKey(civilDate, decision.slotKey)
          : null;
        if (occKey) {
          row.slotsToday = claimedSlotsToJson(
            appendClaimedSlot(row.slotsToday, occKey, 'SENT', civilDate, {
              lastSentAt: row.lastSentAt,
              timezone,
            }),
          );
        }
        row.dailyStatus = decision.nextStatus ?? row.dailyStatus;
        row.lastSentAt = nowJs;
        row.silenceUntil = decision.silenceUntil ?? null;
        row.sentCount += 1;
        this.syncGoal(goal, row);
      }
      return true;
    } catch {
      items.forEach((item, i) => this.rows.set(item.goal.id, backups[i]));
      return false;
    }
  }

  async rollback(snapshots: ClaimSnapshot[]): Promise<void> {
    for (const prev of snapshots) {
      this.rows.set(prev.id, {
        goalId: prev.id,
        dailyStatus: prev.dailyStatus ?? null,
        lastSentAt: prev.lastSentAt
          ? new Date(prev.lastSentAt)
          : null,
        silenceUntil: prev.silenceUntil ? new Date(prev.silenceUntil) : null,
        sentCount: prev.sentCount,
        slotsToday: prev.slotsToday ?? [],
      });
    }
  }

  private ensure(goal: ReminderGoalRecord): ClaimRow {
    if (!this.rows.has(goal.id)) this.seedFromGoal(goal);
    return this.rows.get(goal.id)!;
  }

  private syncGoal(goal: ReminderGoalRecord, row: ClaimRow) {
    goal.reminder.dailyStatus = row.dailyStatus;
    goal.reminder.lastSentAt = row.lastSentAt;
    goal.reminder.silenceUntil = row.silenceUntil;
    goal.reminder.sentCount = row.sentCount;
    goal.reminder.slotsToday = row.slotsToday;
  }
}
