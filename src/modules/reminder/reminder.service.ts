import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import { ReminderDeliveryService } from './reminder-delivery.service';
import { ReminderPolicyEngine } from './reminder-policy.engine';
import { ReminderObservabilityService } from './reminder-observability.service';
import {
  REMINDER_POLICY_ACTIONS,
  ReminderGoalRecord,
  ReminderPolicyDecision,
} from './reminder.types';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly policyEngine: ReminderPolicyEngine,
    private readonly deliveryService: ReminderDeliveryService,
    private readonly observability: ReminderObservabilityService,
  ) {}

  @Cron('0 * * * * *') // A cada minuto para testes - mudar para EVERY_HOUR em produção
  async sendReminders() {
    const goals = (await this.userGoalService.getActiveGoalsForReminders()) as ReminderGoalRecord[];
    const now = DateTime.now().toUTC();

    for (const goal of goals) {
      const timezone = goal.user?.timezone || 'America/Sao_Paulo';
      const decision = this.policyEngine.evaluate({
        goal,
        now,
        timezone,
      });

      this.observability.policy({
        goalId: goal.id,
        userId: goal.userId,
        action: decision.action,
        kind: decision.kind,
        statusBefore: goal.dailyStatus,
        reason: decision.reason,
      });

      if (decision.action === REMINDER_POLICY_ACTIONS.WAIT) {
        continue;
      }

      if (decision.action === REMINDER_POLICY_ACTIONS.SKIP_CYCLE) {
        await this.userGoalService.updateReminderState(goal.id, {
          dailyStatus: decision.nextStatus,
          silenceUntil: decision.silenceUntil ?? null,
        });
        continue;
      }

      const previousState = {
        dailyStatus: goal.dailyStatus,
        lastReminderSentAt: goal.lastReminderSentAt,
        silenceUntil: goal.silenceUntil,
      };

      const marked = await this.markReminderDispatch(goal, now, decision);
      if (!marked) {
        continue;
      }

      goal.dailyStatus = decision.nextStatus ?? goal.dailyStatus;
      goal.lastReminderSentAt = now.toJSDate();
      goal.silenceUntil = decision.silenceUntil ?? null;
      goal.reminderCount = (goal.reminderCount || 0) + 1;

      try {
        const delivered = await this.deliveryService.deliver({
          goal,
          kind: decision.kind!,
          timezone,
          sentAt: now.toJSDate(),
        });

        if (!delivered) {
          throw new Error('delivery_failed');
        }
      } catch (error) {
        this.logger.error(
          `Erro ao entregar reminder para goal=${goal.id}`,
          error as Error,
        );
        await prisma.userGoal.update({
          where: { id: goal.id },
          data: {
            dailyStatus: previousState.dailyStatus,
            lastReminderSentAt: previousState.lastReminderSentAt
              ? new Date(previousState.lastReminderSentAt)
              : null,
            silenceUntil: previousState.silenceUntil
              ? new Date(previousState.silenceUntil)
              : null,
            reminderCount: { decrement: 1 },
          },
        });
      }
    }
  }

  @Cron('0 0 * * *') // Reset diário às 00:00
  async resetDailyStatus() {
    await prisma.userGoal.updateMany({
      where: {
        completed: false,
        OR: [
          { dailyStatus: 'DONE' },
          { silenceUntil: { lte: DateTime.now().toUTC().toJSDate() } },
        ],
      },
      data: {
        dailyStatus: null,
        silenceUntil: null,
      },
    });
  }

  private async markReminderDispatch(
    goal: ReminderGoalRecord,
    now: DateTime,
    decision: ReminderPolicyDecision,
  ) {
    const where: Record<string, unknown> = { id: goal.id };

    if (goal.lastReminderSentAt) {
      where.lastReminderSentAt = new Date(goal.lastReminderSentAt);
    } else {
      where.lastReminderSentAt = null;
    }

    if (goal.dailyStatus) {
      where.dailyStatus = goal.dailyStatus;
    }

    const result = await prisma.userGoal.updateMany({
      where,
      data: {
        dailyStatus: decision.nextStatus ?? null,
        lastReminderSentAt: now.toJSDate(),
        silenceUntil: decision.silenceUntil ?? null,
        reminderCount: { increment: 1 },
      },
    });

    return result.count === 1;
  }
}