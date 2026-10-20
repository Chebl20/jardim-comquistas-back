import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { FLOW_STATES } from '../ia/conversation/flow.types';

export const COACH_TASK_STATUS = {
  PENDING_USER: 'PENDING_USER',
  SCHEDULED: 'SCHEDULED',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;

export const COACH_TASK_KIND = {
  WEEKLY_PROGRESS_CHECK: 'WEEKLY_PROGRESS_CHECK',
  REMINDER_FOLLOW_UP: 'REMINDER_FOLLOW_UP',
  CUSTOM: 'CUSTOM',
} as const;

@Injectable()
export class CoachTaskService {
  private readonly logger = new Logger(CoachTaskService.name);

  async getOpenTaskForUser(userId: string) {
    return prisma.coachTask.findFirst({
      where: {
        userId,
        status: COACH_TASK_STATUS.PENDING_USER,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTask(input: {
    userId: string;
    kind: string;
    title: string;
    payload?: Record<string, unknown>;
    goalId?: string;
    dueAt?: Date;
  }) {
    return prisma.coachTask.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        payload: input.payload
          ? (input.payload as Prisma.InputJsonValue)
          : undefined,
        goalId: input.goalId ?? null,
        dueAt: input.dueAt ?? null,
        status: COACH_TASK_STATUS.PENDING_USER,
      },
    });
  }

  async completeTask(taskId: string, userId: string) {
    return prisma.coachTask.updateMany({
      where: { id: taskId, userId },
      data: {
        status: COACH_TASK_STATUS.DONE,
        completedAt: new Date(),
      },
    });
  }

  async failTask(taskId: string, userId: string) {
    return prisma.coachTask.updateMany({
      where: { id: taskId, userId },
      data: { status: COACH_TASK_STATUS.FAILED },
    });
  }

  /**
   * Mapeia tarefa aberta para estado do orquestrador (retomada).
   */
  resolveFlowStateForTask(task: { kind: string; payload: unknown }): string {
    const payload =
      task.payload && typeof task.payload === 'object'
        ? (task.payload as Record<string, unknown>)
        : {};
    if (payload.flowState && typeof payload.flowState === 'string') {
      return payload.flowState;
    }
    if (task.kind === COACH_TASK_KIND.WEEKLY_PROGRESS_CHECK) {
      return FLOW_STATES.GOAL_PROGRESS;
    }
    return FLOW_STATES.CLARIFICATION;
  }

  async ensureWeeklyProgressTasks(): Promise<number> {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const activeGoals = await prisma.goal.findMany({
      where: { status: 'ACTIVE', completed: false },
      select: {
        id: true,
        userId: true,
        title: true,
        updatedAt: true,
      },
    });

    const byUser = new Map<string, typeof activeGoals>();
    for (const g of activeGoals) {
      const list = byUser.get(g.userId) || [];
      list.push(g);
      byUser.set(g.userId, list);
    }

    let created = 0;
    for (const [userId, goals] of byUser) {
      const stale = goals.filter((g) => g.updatedAt < weekAgo);
      if (stale.length === 0) continue;

      const open = await this.getOpenTaskForUser(userId);
      if (open) continue;

      await this.createTask({
        userId,
        kind: COACH_TASK_KIND.WEEKLY_PROGRESS_CHECK,
        title: `Registrar progresso em ${stale.length} meta(s)`,
        payload: {
          flowState: FLOW_STATES.GOAL_PROGRESS,
          goalIds: stale.map((g) => g.id),
          proactiveMessage: `Você tem ${stale.length} meta(s) sem atualização esta semana. Quer registrar o progresso agora? Responda com o nome da meta ou "todas".`,
        },
      });
      created += 1;
    }
    this.logger.log(`ensureWeeklyProgressTasks: created=${created}`);
    return created;
  }
}
