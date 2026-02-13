import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';

@Injectable()
export class RulesService {
  /**
   * Verifica se uma meta pode ser reagendada.
   * Regras: Meta deve existir, não estar completada, e ter reminderTime.
   */
  async canRescheduleGoal(goalId: string): Promise<boolean> {
    try {
      const goal = await prisma.userGoal.findUnique({
        where: { id: goalId },
        select: { completed: true, reminderTime: true },
      });
      return goal ? !goal.completed && !!goal.reminderTime : false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica se uma meta pode ser marcada como feita.
   * Regras: Meta deve existir, não estar completada.
   */
  async canMarkDone(goalId: string): Promise<boolean> {
    try {
      const goal = await prisma.userGoal.findUnique({
        where: { id: goalId },
        select: { completed: true },
      });
      return goal ? !goal.completed : false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica se uma meta pode ser abandonada.
   * Regras: Meta deve existir, não estar completada.
   */
  async canAbandonGoal(goalId: string): Promise<boolean> {
    try {
      const goal = await prisma.userGoal.findUnique({
        where: { id: goalId },
        select: { completed: true },
      });
      return goal ? !goal.completed : false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifica se um lembrete ainda faz sentido enviar.
   * Regras: Meta ativa, horário não passou, não foi enviado recentemente.
   */
  async shouldSendReminder(goal: any, now: Date): Promise<boolean> {
    if (goal.completed) return false;
    if (!goal.reminderTime) return false;

    const reminderTime = new Date(goal.reminderTime);
    const todayReminder = new Date(now.getFullYear(), now.getMonth(), now.getDate(), reminderTime.getHours(), reminderTime.getMinutes(), 0);
    const reminderWindowStart = new Date(todayReminder.getTime() - 10 * 60 * 1000);

    return now >= reminderWindowStart && now <= todayReminder;
  }
}