import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { UserGoalService } from '../../../goals/user-goal.service';
import { FLOW_STATES } from '../flow.types';
import { NucleusMetaBuilder, NucleusMetaBuildContext } from './nucleus-meta.builder';
import { formatScheduleSummary } from '../../../shared/schedule-formatter.util';
import { luxonWeekdayToJsDayOfWeek, normalizeDaysOfWeekJson } from '../../../shared/weekday.util';
import type { ScheduleConfig } from '../flow.types';

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
    const now = new Date();
    const meta: Record<string, any> = {
      ...sessionPayload,
      worldId,
      recentMessages: recent.slice(-this.recentMessagesContext),
      nowISO: now.toISOString(),
    };

    if (meta.userGoalsSummary) {
      return meta;
    }

    try {
      const formatTime = (dt: Date | string): string =>
        new Date(dt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timezone,
        });

      const nextReminderFromSchedule = (sc: ScheduleConfig): string | null => {
        if (sc.type === 'once') {
          const reminder = new Date(sc.at);
          const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const userReminder = new Date(reminder.toLocaleString('en-US', { timeZone: timezone }));
          const diffDays = Math.floor(
            (userReminder.setHours(0, 0, 0, 0) - new Date(userNow.toDateString()).getTime()) / 86400000,
          );
          const timeStr = formatTime(reminder);
          if (userReminder <= userNow) {
            if (diffDays === 0) return `hoje às ${timeStr}`;
            return null;
          }
          const dateLabel = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`;
          return `${dateLabel} às ${timeStr}`;
        }
        if (sc.type === 'daily' || sc.type === 'weekly') {
          const timeStr = sc.times[0];
          if (!timeStr) return null;
          const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const [hh, mm] = timeStr.split(':').map(Number);
          const userReminderToday = new Date(userNow);
          userReminderToday.setHours(hh || 0, mm || 0, 0, 0);
          return userReminderToday > userNow ? `hoje às ${timeStr}` : `amanhã às ${timeStr}`;
        }
        return null;
      };

      const nextReminderLabel = (
        reminderTimeDt: Date | string | null,
        goalType: string,
        frequency: number | null,
        scheduleConfig?: unknown,
      ): string | null => {
        const sc = scheduleConfig as ScheduleConfig | undefined;
        if (sc && typeof sc === 'object' && (sc.type === 'once' || sc.type === 'daily' || sc.type === 'weekly')) {
          return nextReminderFromSchedule(sc);
        }
        if (!reminderTimeDt) return null;
        try {
          const reminder = new Date(reminderTimeDt);
          const timeStr = formatTime(reminder);

          if (goalType === 'Pontual') {
            const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            const userReminder = new Date(reminder.toLocaleString('en-US', { timeZone: timezone }));
            const diffDays = Math.floor(
              (userReminder.setHours(0, 0, 0, 0) - new Date(userNow.toDateString()).getTime()) / 86400000,
            );
            if (userReminder <= userNow) {
              if (diffDays === 0) return `hoje às ${timeStr}`;
              return null;
            }
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

      const allGoals = await this.userGoalService.getGoalsForUser(userId);
      const goals = (allGoals || []).filter(
        (g: any) => !(g.goalType === 'Pontual' && g.completed === true),
      );
      const completedPontualGoals = (allGoals || []).filter(
        (g: any) => g.goalType === 'Pontual' && g.completed === true,
      );
      const total = goals.length;

      const summarizeGoal = (g: any) => {
        const reminderFormatted = g.reminderTime ? formatTime(g.reminderTime) : null;
        const nextReminder =
          g.scheduleConfig || g.reminderTime
            ? nextReminderLabel(g.reminderTime, g.goalType, g.frequency ?? null, g.scheduleConfig)
            : null;
        const scheduleSummary = g.scheduleConfig ? formatScheduleSummary(g.scheduleConfig, timezone) : null;
        const growthEvents = Array.isArray(g.plantedTree?.growthEvents) ? g.plantedTree.growthEvents : [];
        const recentProgress = growthEvents.slice(0, 3).map((p: any) => ({
          date: p.createdAt,
          title: p.title,
          description: p.description,
        }));
        return {
          id: g.id,
          title: g.title,
          type: g.goalType,
          conquestType: g.conquestType,
          completed: g.completed,
          reminderTime: reminderFormatted,
          scheduleConfig: g.scheduleConfig,
          scheduleSummary,
          nextReminder,
          frequency: g.frequency ?? null,
          currentStage: g.plantedTree?.actualStage,
          recentProgress,
          growthEvents: growthEvents.map((ge: any) => ({
            createdAt: typeof ge.createdAt === 'string' ? ge.createdAt : new Date(ge.createdAt).toISOString(),
          })),
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

      meta.userGoalsSummaryCompletedPontual = (completedPontualGoals || []).map((g: any) => ({
        id: g.id,
        title: g.title,
        type: g.goalType,
        conquestType: g.conquestType,
        completed: true,
        reminderTime: g.reminderTime ? formatTime(g.reminderTime) : null,
        scheduleConfig: g.scheduleConfig,
        scheduleSummary: g.scheduleConfig ? formatScheduleSummary(g.scheduleConfig, timezone) : null,
      }));
      meta.totalCompletedPontual = meta.userGoalsSummaryCompletedPontual.length;

      const todayGoals = await this.userGoalService.getGoalsForDateForUser(
        userId,
        DateTime.now().setZone(timezone),
        timezone,
        { includeCompleted: true },
      );
      const tomorrowGoals = await this.userGoalService.getGoalsForTomorrowForUser(userId, timezone);

      const todaySummarized = todayGoals.map((g: any) => summarizeGoal(g));
      const nowDt = DateTime.now().setZone(timezone);
      const todayDow = luxonWeekdayToJsDayOfWeek(nowDt.weekday);
      meta.userGoalsSummaryForToday = todaySummarized.filter((s: any) => {
        const nr = String(s?.nextReminder || '');
        if (s?.type === 'Pontual' && (nr.startsWith('amanhã') || nr.startsWith('em '))) return false;
        const sc = s?.scheduleConfig;
        if (sc?.type === 'weekly' && !normalizeDaysOfWeekJson(sc.daysOfWeek).includes(todayDow)) return false;
        if (sc?.type === 'monthly' && typeof sc.dayOfMonth === 'number' && nowDt.day !== sc.dayOfMonth)
          return false;
        return true;
      });
      meta.userGoalsSummaryForTomorrow = tomorrowGoals.map((g: any) => summarizeGoal(g));
    } catch (e) {
      this.logger.warn('Failed to fetch userGoals for GoalStatus nucleus', e);
    }

    return meta;
  }
}
