import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import { ReminderDeliveryService } from './delivery/reminder-delivery.service';
import { ReminderPolicyEngine } from './policy/reminder-policy.engine';
import { ReminderObservabilityService } from './observability/reminder-observability.service';
import {
  REMINDER_POLICY_ACTIONS,
  ReminderGoalRecord,
  ReminderPolicyDecision,
} from './reminder.types';
import {
  clusterGoalsIntoGroups,
  filterGoalsForToday,
  type ReminderGroup,
} from './grouping/reminder-group.util';

const GROUP_WINDOW_MINUTES = Number(process.env.REMINDER_GROUP_WINDOW_MINUTES || 60);
const GROUP_FOLLOW_UP_MINUTES = Number(process.env.REMINDER_GROUP_FOLLOW_UP_MINUTES || 5);
const GROUP_LAST_CHANCE_MINUTES = Number(process.env.REMINDER_GROUP_LAST_CHANCE_MINUTES || 15);

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

    const byUser = new Map<string, ReminderGoalRecord[]>();
    for (const g of goals) {
      const list = byUser.get(g.userId) || [];
      list.push(g);
      byUser.set(g.userId, list);
    }

    for (const [userId, userGoals] of byUser) {
      const timezone = userGoals[0]?.user?.timezone || 'America/Sao_Paulo';
      const todayGoals = filterGoalsForToday(userGoals, timezone);
      const groups = clusterGoalsIntoGroups(
        todayGoals,
        timezone,
        GROUP_WINDOW_MINUTES,
        GROUP_FOLLOW_UP_MINUTES,
        GROUP_LAST_CHANCE_MINUTES,
      );

      const goalToGroup = new Map<string, ReminderGroup>();
      for (const group of groups) {
        for (const g of group.goals) {
          goalToGroup.set(g.id, group);
        }
      }

      const processedGroupKeys = new Set<string>();
      const toSend: { goal: ReminderGoalRecord; decision: ReminderPolicyDecision }[] = [];

      for (const goal of userGoals) {
        const group = goalToGroup.get(goal.id);
        const groupKey = group ? group.goals.map((g) => g.id).sort().join(',') : null;

        if (groupKey && processedGroupKeys.has(groupKey)) continue;

        const decision = this.policyEngine.evaluate({
          goal,
          now,
          timezone,
          group,
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

        if (
          decision.action === REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL ||
          decision.action === REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP ||
          decision.action === REMINDER_POLICY_ACTIONS.SEND_LAST_CHANCE
        ) {
          if (
            group &&
            (decision.action === REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP ||
              decision.action === REMINDER_POLICY_ACTIONS.SEND_LAST_CHANCE)
          ) {
            for (const g of group.goals) {
              toSend.push({ goal: g, decision });
            }
            processedGroupKeys.add(groupKey!);
          } else {
            toSend.push({ goal, decision });
          }
        }
      }

      if (toSend.length === 0) continue;

      if (toSend.length >= 2) {
        await this.sendBatch(toSend, now, timezone);
      } else {
        await this.sendSingle(toSend[0], now, timezone);
      }
    }
  }

  private async sendBatch(
    items: { goal: ReminderGoalRecord; decision: ReminderPolicyDecision }[],
    now: DateTime,
    timezone: string,
  ) {
    const goals = items.map((i) => i.goal);
    const decisions = items.map((i) => i.decision);
    const previousStates = goals.map((g) => ({
      id: g.id,
      dailyStatus: g.dailyStatus,
      lastReminderSentAt: g.lastReminderSentAt,
      silenceUntil: g.silenceUntil,
      reminderSlotsToday: g.reminderSlotsToday,
    }));

    const marked = await this.markReminderDispatchBatch(goals, decisions, now);
    if (!marked) return;

    const followUpDecision = decisions.find(
      (d) => d.kind === 'follow_up' || d.kind === 'last_chance',
    );
    const kind = followUpDecision?.kind ?? decisions[0].kind!;

    try {
      const delivered = await this.deliveryService.deliverBatch({
        goals,
        kind,
        timezone,
        sentAt: now.toJSDate(),
        userId: goals[0].userId,
      });

      if (!delivered) {
        throw new Error('delivery_failed');
      }
    } catch (error) {
      this.logger.error(`Erro ao entregar batch de reminders`, error as Error);
      // Rollback: restaurar estado anterior no GoalReminder
      for (const prev of previousStates) {
        await prisma.goalReminder.updateMany({
          where: { goalId: prev.id },
          data: {
            dailyStatus: prev.dailyStatus,
            lastSentAt: prev.lastReminderSentAt
              ? new Date(prev.lastReminderSentAt)
              : null,
            silenceUntil: prev.silenceUntil ? new Date(prev.silenceUntil) : null,
            sentCount: { decrement: 1 } as any,
            slotsToday: prev.reminderSlotsToday ?? undefined,
          },
        });
      }
    }
  }

  private async sendSingle(
    item: { goal: ReminderGoalRecord; decision: ReminderPolicyDecision },
    now: DateTime,
    timezone: string,
  ) {
    const { goal, decision } = item;
    const previousState = {
      dailyStatus: goal.dailyStatus,
      lastReminderSentAt: goal.lastReminderSentAt,
      silenceUntil: goal.silenceUntil,
      reminderSlotsToday: goal.reminderSlotsToday,
    };

    const marked = await this.markReminderDispatch(goal, now, decision);
    if (!marked) return;

    // Atualizar os campos do goal em memória (para delivery)
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
      // Rollback: restaurar estado anterior no GoalReminder
      await prisma.goalReminder.updateMany({
        where: { goalId: goal.id },
        data: {
          dailyStatus: previousState.dailyStatus,
          lastSentAt: previousState.lastReminderSentAt
            ? new Date(previousState.lastReminderSentAt)
            : null,
          silenceUntil: previousState.silenceUntil
            ? new Date(previousState.silenceUntil)
            : null,
          sentCount: { decrement: 1 } as any,
          slotsToday: previousState.reminderSlotsToday ?? undefined,
        },
      });
    }
  }

  private async markReminderDispatchBatch(
    goals: ReminderGoalRecord[],
    decisions: ReminderPolicyDecision[],
    now: DateTime,
  ): Promise<boolean> {
    for (let i = 0; i < goals.length; i++) {
      const ok = await this.markReminderDispatch(goals[i], now, decisions[i]);
      if (!ok) return false;
      goals[i].dailyStatus = decisions[i].nextStatus ?? goals[i].dailyStatus;
      goals[i].lastReminderSentAt = now.toJSDate();
      goals[i].silenceUntil = decisions[i].silenceUntil ?? null;
      goals[i].reminderCount = (goals[i].reminderCount || 0) + 1;
    }
    return true;
  }

  @Cron('0 0 * * *') // Reset diário às 00:00
  async resetDailyStatus() {
    // Reset nos registros GoalReminder (tabela normalizada)
    await prisma.goalReminder.updateMany({
      where: {
        OR: [
          { dailyStatus: 'DONE' },
          { silenceUntil: { lte: DateTime.now().toUTC().toJSDate() } },
        ],
        goal: { completed: false },
      },
      data: {
        dailyStatus: null,
        silenceUntil: null,
        slotsToday: [],
      },
    });
  }

  private async markReminderDispatch(
    goal: ReminderGoalRecord,
    now: DateTime,
    decision: ReminderPolicyDecision,
  ) {
    const where: Record<string, unknown> = { goalId: goal.id };

    // Otimistic lock: só atualiza se o estado não mudou desde que lemos
    if (goal.lastReminderSentAt) {
      where.lastSentAt = new Date(goal.lastReminderSentAt);
    } else {
      where.lastSentAt = null;
    }
    if (goal.dailyStatus) {
      where.dailyStatus = goal.dailyStatus;
    }

    const slots = Array.isArray(goal.reminderSlotsToday) ? [...goal.reminderSlotsToday] : [];
    if (decision.slotKey) {
      slots.push({ time: decision.slotKey });
    }

    const updateData: Record<string, unknown> = {
      dailyStatus: decision.nextStatus ?? null,
      lastSentAt: now.toJSDate(),
      silenceUntil: decision.silenceUntil ?? null,
      sentCount: { increment: 1 },
    };
    if (decision.slotKey) {
      updateData.slotsToday = slots;
    }

    const result = await prisma.goalReminder.updateMany({
      where,
      data: updateData,
    });

    return result.count === 1;
  }
}