import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ReminderNucleus } from '../../ia/nuclei/reminder';
import { pickGoalEmoji } from '../../shared/goal-emoji.util';
import { ConversationSessionService } from '../../shared/conversation-session.service';
import { FLOW_STATES } from '../../ia/conversation/flow.types';
import { UserGoalService } from '../../goals/user-goal.service';
import {
  ReminderGoalRecord,
  ReminderKind,
  ReminderSessionContext,
} from '../reminder.types';

export type ComposedReminder = {
  text: string;
  userId: string;
  mainGoal: ReminderGoalRecord;
  reminderContext: ReminderSessionContext;
  pendingGoalIds: string[];
};

@Injectable()
export class ReminderCopyBuilder {
  private readonly reminderSessionTtlMinutes = Number(
    process.env.REMINDER_SESSION_TTL_MINUTES || 180,
  );

  constructor(
    private readonly reminderNucleus: ReminderNucleus,
    private readonly conversationSession: ConversationSessionService,
    private readonly userGoalService: UserGoalService,
  ) {}

  async composeSingle(
    goal: ReminderGoalRecord,
    kind: ReminderKind,
    timezone: string,
    sentAt: Date,
  ): Promise<ComposedReminder> {
    const text = await this.buildMessageInternal(goal, kind, timezone, [
      goal.id,
    ]);
    const ignoredGoals = await this.userGoalService.getIgnoredGoalsForToday(
      goal.userId,
      timezone,
      [goal.id],
    );
    const pendingGoalIds = [goal.id, ...ignoredGoals.map((g) => g.id)];
    return {
      text,
      userId: goal.userId,
      mainGoal: goal,
      pendingGoalIds,
      reminderContext: this.context(goal, kind, timezone, sentAt, pendingGoalIds),
    };
  }

  async composeBatch(
    goals: ReminderGoalRecord[],
    kind: ReminderKind,
    timezone: string,
    sentAt: Date,
    userId: string,
  ): Promise<ComposedReminder> {
    const mainGoal = this.pickMainGoal(goals);
    const text = await this.buildMessageInternal(mainGoal, kind, timezone, [
      mainGoal.id,
    ]);
    const ignoredGoals = await this.userGoalService.getIgnoredGoalsForToday(
      userId,
      timezone,
      [mainGoal.id],
    );
    const pendingGoalIds = [
      ...new Set([
        ...goals.map((g) => g.id),
        ...ignoredGoals.map((g) => g.id),
      ]),
    ];
    return {
      text,
      userId,
      mainGoal,
      pendingGoalIds,
      reminderContext: this.context(
        mainGoal,
        kind,
        timezone,
        sentAt,
        pendingGoalIds,
      ),
    };
  }

  async primeSession(composed: ComposedReminder): Promise<void> {
    await this.conversationSession.upsertSessionState(
      composed.userId,
      FLOW_STATES.REMINDER,
      {
        lastBotOrigin: 'reminder',
        pendingGoalId: composed.mainGoal.id,
        pendingGoalTitle: composed.mainGoal.title,
        pendingGoalDescription: composed.mainGoal.description || '',
        pendingGoalIds: composed.pendingGoalIds,
        reminderContext: composed.reminderContext,
      },
      this.reminderSessionTtlMinutes,
    );
  }

  private context(
    goal: ReminderGoalRecord,
    kind: ReminderKind,
    timezone: string,
    sentAt: Date,
    pendingGoalIds: string[],
  ): ReminderSessionContext {
    return {
      reminderKind: kind,
      pendingGoalId: goal.id,
      pendingGoalTitle: goal.title,
      pendingGoalDescription: goal.description || '',
      goalType: goal.goalKind,
      reminderTime:
        goal.schedule?.type === 'once' ? goal.schedule.at : null,
      reminderCount: goal.reminder.sentCount,
      timezone,
      sentAt: sentAt.toISOString(),
      pendingGoalIds,
    };
  }

  private pickMainGoal(goals: ReminderGoalRecord[]): ReminderGoalRecord {
    const followUp = goals.filter(
      (g) =>
        g.reminder.dailyStatus === 'WAITING_OPERATIONAL_REPLY' ||
        g.reminder.dailyStatus === 'WAITING_FOLLOW_UP_REPLY',
    );
    const candidates = followUp.length > 0 ? followUp : goals;
    return candidates.reduce((a, b) => {
      const aSent = a.reminder.lastSentAt
        ? new Date(a.reminder.lastSentAt).getTime()
        : 0;
      const bSent = b.reminder.lastSentAt
        ? new Date(b.reminder.lastSentAt).getTime()
        : 0;
      if (aSent > 0 && bSent > 0) return aSent < bSent ? a : b;
      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      return aCreated < bCreated ? a : b;
    });
  }

  private async buildMessageInternal(
    goal: ReminderGoalRecord,
    kind: ReminderKind,
    timezone: string,
    excludeGoalIds: string[],
  ): Promise<string> {
    const latestProgress = goal.plantedTree?.growthEvents?.[0]?.createdAt;
    const inactivityDays = latestProgress
      ? Math.max(
          0,
          Math.floor(
            DateTime.now()
              .setZone(timezone)
              .diff(
                DateTime.fromJSDate(new Date(latestProgress)).setZone(timezone),
                'days',
              ).days,
          ),
        )
      : Math.max(
          0,
          Math.floor(
            DateTime.now()
              .setZone(timezone)
              .diff(
                DateTime.fromJSDate(new Date(goal.createdAt)).setZone(timezone),
                'days',
              ).days,
          ),
        );

    const goalsWithStatus =
      await this.userGoalService.getGoalsForTodayWithStatus(
        goal.userId,
        timezone,
      );
    const doneCount = goalsWithStatus.filter(
      (g) => g.dailyStatus === 'DONE',
    ).length;
    const totalCount = goalsWithStatus.length;
    const pendingCount = totalCount - doneCount;

    const result = await this.reminderNucleus.analyze({
      userId: goal.userId,
      currentSession: FLOW_STATES.REMINDER,
      text: '',
      meta: {
        userName: goal.user?.name,
        goalId: goal.id,
        goalTitle: goal.title,
        goalDescription: goal.description || '',
        goalType: goal.goalKind as 'Pontual' | 'Continua',
        reminderTime:
          goal.schedule?.type === 'once' ? goal.schedule.at : undefined,
        reminderCount: goal.reminder.sentCount || 0,
        reminderKind: kind,
        inactivityDays,
        lastProgressAt: latestProgress
          ? new Date(latestProgress).toISOString()
          : undefined,
        goalCreatedAt: new Date(goal.createdAt).toISOString(),
        pendingCount,
        doneCount,
        totalCount,
      },
    });

    const fraseMotivadora =
      (result.actions[0] as { text?: string } | undefined)?.text || goal.title;
    const emoji = pickGoalEmoji(goal.conquestType, goal.title);
    const userName = goal.user?.name || '';

    const ignoredGoals = await this.userGoalService.getIgnoredGoalsForToday(
      goal.userId,
      timezone,
      excludeGoalIds,
    );
    const MAX_PENDENTES = 5;
    const pendentesTitles = ignoredGoals
      .slice(0, MAX_PENDENTES)
      .map((g) => g.title);
    const restCount = ignoredGoals.length - MAX_PENDENTES;
    const showPendentes = pendentesTitles.length > 0;

    let msg = `${emoji} ${userName}, está na hora de: ${goal.title}\n\n${fraseMotivadora}`;
    if (showPendentes) {
      msg += `\n\nAlém disso, estas metas ainda estão pendentes hoje:\n`;
      msg += pendentesTitles.map((t) => `• ${t}`).join('\n');
      if (restCount > 0) {
        msg += `\n(e mais ${restCount} outras pendentes)`;
      }
    }
    const isFirstReminder = kind === 'operational';
    if (totalCount > 1 && !isFirstReminder) {
      msg += `\n\nProgresso hoje: ${doneCount}/${totalCount} metas concluídas`;
    }

    return msg;
  }
}
