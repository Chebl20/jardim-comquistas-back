import { Injectable, Logger } from '@nestjs/common';
import { UserGoalService } from '../../../goals/user-goal.service';
import { FLOW_STATES } from '../flow.types';
import { NucleusMetaBuilder, NucleusMetaBuildContext } from './nucleus-meta.builder';

@Injectable()
export class GoalStatusMetaBuilder implements NucleusMetaBuilder {
  private readonly logger = new Logger(GoalStatusMetaBuilder.name);
  private readonly goalsSummaryThreshold = 8;
  private readonly recentMessagesContext = 3;

  constructor(private readonly userGoalService: UserGoalService) {}

  supports(state: string): boolean {
    return state === FLOW_STATES.GOAL_STATUS;
  }

  async build(context: NucleusMetaBuildContext): Promise<Record<string, any>> {
    const { sessionPayload, worldId, userId, timezone } = context;
    const recent = Array.isArray(sessionPayload.recentMessages) ? sessionPayload.recentMessages : [];
    const meta: Record<string, any> = {
      ...sessionPayload,
      worldId,
      recentMessages: recent.slice(-this.recentMessagesContext),
    };

    if (meta.userGoalsSummary) {
      return meta;
    }

    try {
      const now = new Date();
      const formatTime = (dt: Date | string): string =>
        new Date(dt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
        });

      const nextReminderLabel = (
        reminderTimeDt: Date | string | null,
        goalType: string,
        frequency: number | null,
      ): string | null => {
        if (!reminderTimeDt) return null;
        try {
          const reminder = new Date(reminderTimeDt);
          const timeStr = formatTime(reminder);

          if (goalType === 'Pontual') {
            const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            const userReminder = new Date(reminder.toLocaleString('en-US', { timeZone: timezone }));
            if (userReminder <= userNow) return null;
            const diffDays = Math.floor(
              (userReminder.setHours(0, 0, 0, 0) - new Date(userNow.toDateString()).getTime()) / 86400000,
            );
            const dateLabel =
              diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`;
            return `${dateLabel} às ${timeStr}`;
          }

          const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const userReminderToday = new Date(userNow);
          userReminderToday.setHours(
            parseInt(timeStr.split(':')[0], 10),
            parseInt(timeStr.split(':')[1], 10),
            0,
            0,
          );

          const freq = frequency ?? 1;
          if (freq >= 1) {
            return userReminderToday > userNow ? `hoje às ${timeStr}` : `amanhã às ${timeStr}`;
          }

          return `às ${timeStr}`;
        } catch {
          return null;
        }
      };

      const goals = await this.userGoalService.getGoalsForUser(userId);
      const total = Array.isArray(goals) ? goals.length : 0;

      const summarizeGoal = (g: any) => {
        const reminderFormatted = g.reminderTime ? formatTime(g.reminderTime) : null;
        const nextReminder = g.reminderTime
          ? nextReminderLabel(g.reminderTime, g.goalType, g.frequency ?? null)
          : null;
        return {
          id: g.id,
          title: g.title,
          type: g.goalType,
          conquestType: g.conquestType,
          completed: g.completed,
          reminderTime: reminderFormatted,
          nextReminder,
          frequency: g.frequency ?? null,
          currentStage: g.plantedTree?.actualStage,
          recentProgress: Array.isArray(g.progresses)
            ? g.progresses.slice(-3).map((p: any) => ({
                date: p.createdAt,
                title: p.title,
                description: p.description,
              }))
            : [],
        };
      };

      if (total > this.goalsSummaryThreshold) {
        meta.userGoalsSummary = (goals || []).map((g: any) => ({
          id: g.id,
          title: g.title,
          createdAt: g.createdAt,
          plantedTreeStage: g.plantedTree?.actualStage,
        }));
        meta._fullUserGoalsAvailable = false;
      } else {
        meta.userGoalsSummary = (goals || []).map(summarizeGoal);
        meta._fullUserGoalsAvailable = true;
      }
      meta.totalGoals = total;
    } catch (e) {
      this.logger.warn('Failed to fetch userGoals for GoalStatus nucleus', e);
    }

    return meta;
  }
}
