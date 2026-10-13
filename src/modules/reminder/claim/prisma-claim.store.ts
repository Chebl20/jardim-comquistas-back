import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../../prisma/client';
import { appendClaimedSlot, claimedSlotsToJson } from './claimed-slots.util';
import { makeOccKey, parseOccKey } from '../../shared/occurrence-key.util';
import type {
  ClaimDispatchItem,
  ClaimSnapshot,
  ReminderClaimStore,
} from './claim.store';
import type { ReminderGoalRecord, ReminderPolicyDecision } from '../reminder.types';

@Injectable()
export class PrismaClaimStore implements ReminderClaimStore {
  async claimBatch(
    items: ClaimDispatchItem[],
    now: DateTime,
    timezone: string,
  ): Promise<boolean> {
    if (items.length === 0) return false;
    try {
      await prisma.$transaction(async (tx) => {
        for (const { goal, decision } of items) {
          const ok = await this.markOne(goal, now, decision, timezone, tx);
          if (!ok) throw new Error('lock_failed');
          goal.reminder.dailyStatus = decision.nextStatus ?? goal.reminder.dailyStatus;
          goal.reminder.lastSentAt = now.toJSDate();
          goal.reminder.silenceUntil = decision.silenceUntil ?? null;
          goal.reminder.sentCount = (goal.reminder.sentCount || 0) + 1;
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  async rollback(snapshots: ClaimSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    await prisma.$transaction(
      snapshots.map((prev) =>
        prisma.goalReminder.updateMany({
          where: { goalId: prev.id },
          data: this.rollbackData(prev),
        }),
      ),
    );
  }

  private async markOne(
    goal: ReminderGoalRecord,
    now: DateTime,
    decision: ReminderPolicyDecision,
    timezone: string,
    tx: { goalReminder: typeof prisma.goalReminder },
  ): Promise<boolean> {
    const where: Record<string, unknown> = {
      goalId: goal.id,
      lastSentAt: goal.reminder.lastSentAt
        ? new Date(goal.reminder.lastSentAt)
        : { equals: null },
      dailyStatus:
        goal.reminder.dailyStatus == null
          ? { equals: null }
          : goal.reminder.dailyStatus,
    };

    const civilDate = now.setZone(timezone).toISODate() || '';
    const occKey = decision.slotKey
      ? parseOccKey(decision.slotKey)
        ? decision.slotKey
        : makeOccKey(civilDate, decision.slotKey)
      : null;

    const slots = occKey
      ? claimedSlotsToJson(
          appendClaimedSlot(
            goal.reminder.slotsToday,
            occKey,
            'SENT',
            civilDate,
            {
              lastSentAt: goal.reminder.lastSentAt,
              timezone,
            },
          ),
        )
      : goal.reminder.slotsToday;

    const updateData: Record<string, unknown> = {
      dailyStatus: decision.nextStatus ?? null,
      lastSentAt: now.toJSDate(),
      silenceUntil: decision.silenceUntil ?? null,
      sentCount: { increment: 1 },
    };
    if (occKey) {
      updateData.slotsToday = slots as object;
      goal.reminder.slotsToday = slots;
    }

    const result = await tx.goalReminder.updateMany({
      where,
      data: updateData,
    });
    return result.count === 1;
  }

  private rollbackData(prev: ClaimSnapshot) {
    return {
      dailyStatus: prev.dailyStatus ?? null,
      lastSentAt: prev.lastSentAt
        ? new Date(prev.lastSentAt)
        : null,
      silenceUntil: prev.silenceUntil ? new Date(prev.silenceUntil) : null,
      sentCount: prev.sentCount,
      slotsToday:
        prev.slotsToday === null ||
        prev.slotsToday === undefined
          ? Prisma.JsonNull
          : (prev.slotsToday as Prisma.InputJsonValue),
    };
  }
}
