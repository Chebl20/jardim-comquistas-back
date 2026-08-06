import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ReminderNucleus } from '../../ia/nuclei/reminder';
import { pickGoalEmoji } from '../../shared/goal-emoji.util';
import { ConversationSessionService } from '../../shared/conversation-session.service';
import { FLOW_STATES } from '../../ia/conversation/flow.types';
import { UserGoalService } from '../../goals/user-goal.service';
import {
  ReminderBatchDeliveryRequest,
  ReminderDeliveryRequest,
  ReminderGoalRecord,
  ReminderKind,
  ReminderSessionContext,
} from '../reminder.types';
import { ReminderObservabilityService } from '../observability/reminder-observability.service';
import { MessagingService } from '../../messaging/messaging.service';

@Injectable()
export class ReminderDeliveryService {
  private readonly reminderSessionTtlMinutes = Number(
    process.env.REMINDER_SESSION_TTL_MINUTES || 180,
  );

  constructor(
    private readonly messagingService: MessagingService,
    private readonly reminderNucleus: ReminderNucleus,
    private readonly conversationSession: ConversationSessionService,
    private readonly userGoalService: UserGoalService,
    private readonly observability: ReminderObservabilityService,
  ) {}

  async deliver(request: ReminderDeliveryRequest) {
    const user = request.goal.user;
    if (!user || !this.messagingService.hasAnyChannel(user)) {
      this.observability.delivery({
        kind: request.kind,
        goalId: request.goal.id,
        userId: request.goal.userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    const message = await this.buildMessage(request.goal, request.kind, request.timezone);
    const sent = await this.messagingService.sendToUser(user, message, 'reminder');
    if (!sent) {
      this.observability.delivery({
        kind: request.kind,
        goalId: request.goal.id,
        userId: request.goal.userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    const ignoredGoals = await this.userGoalService.getIgnoredGoalsForToday(
      request.goal.userId,
      request.timezone,
      [request.goal.id],
    );
    const pendingGoalIds = [
      request.goal.id,
      ...ignoredGoals.map((g) => g.id),
    ];

    const reminderContext: ReminderSessionContext = {
      reminderKind: request.kind,
      pendingGoalId: request.goal.id,
      pendingGoalTitle: request.goal.title,
      pendingGoalDescription: request.goal.description || '',
      goalType: request.goal.goalKind,
      reminderTime: request.goal.reminderTime
        ? new Date(request.goal.reminderTime).toISOString()
        : null,
      reminderCount: request.goal.reminderCount,
      timezone: request.timezone,
      sentAt: request.sentAt.toISOString(),
      pendingGoalIds,
    };

    await this.conversationSession.upsertSessionState(
      request.goal.userId,
      FLOW_STATES.REMINDER,
      {
        lastBotOrigin: 'reminder',
        pendingGoalId: request.goal.id,
        pendingGoalTitle: request.goal.title,
        pendingGoalDescription: request.goal.description || '',
        pendingGoalIds,
        reminderContext,
      },
      this.reminderSessionTtlMinutes,
    );

    this.observability.delivery({
      kind: request.kind,
      goalId: request.goal.id,
      userId: request.goal.userId,
      status: 'sent',
    });

    return true;
  }

  async deliverBatch(request: ReminderBatchDeliveryRequest): Promise<boolean> {
    if (request.goals.length === 0) return false;
    const firstGoal = request.goals[0];
    const user = firstGoal.user;
    if (!user || !this.messagingService.hasAnyChannel(user)) {
      this.observability.delivery({
        kind: request.kind,
        goalId: firstGoal.id,
        userId: request.userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    const mainGoal = this.pickMainGoal(request.goals);
    const message = await this.buildMessageConsolidated(
      mainGoal,
      request.goals,
      request.kind,
      request.timezone,
    );

    const sent = await this.messagingService.sendToUser(user, message, 'reminder');
    if (!sent) {
      this.observability.delivery({
        kind: request.kind,
        goalId: firstGoal.id,
        userId: request.userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    const ignoredGoals = await this.userGoalService.getIgnoredGoalsForToday(
      request.userId,
      request.timezone,
      [mainGoal.id],
    );
    const pendingGoalIds = [
      ...new Set([
        ...request.goals.map((g) => g.id),
        ...ignoredGoals.map((g) => g.id),
      ]),
    ];

    const reminderContext: ReminderSessionContext = {
      reminderKind: request.kind,
      pendingGoalId: mainGoal.id,
      pendingGoalTitle: mainGoal.title,
      pendingGoalDescription: mainGoal.description || '',
      goalType: mainGoal.goalKind,
      reminderTime: mainGoal.reminderTime
        ? new Date(mainGoal.reminderTime).toISOString()
        : null,
      reminderCount: mainGoal.reminderCount,
      timezone: request.timezone,
      sentAt: request.sentAt.toISOString(),
      pendingGoalIds,
    };

    await this.conversationSession.upsertSessionState(
      request.userId,
      FLOW_STATES.REMINDER,
      {
        lastBotOrigin: 'reminder',
        pendingGoalId: mainGoal.id,
        pendingGoalTitle: mainGoal.title,
        pendingGoalDescription: mainGoal.description || '',
        pendingGoalIds,
        reminderContext,
      },
      this.reminderSessionTtlMinutes,
    );

    this.observability.delivery({
      kind: request.kind,
      goalId: mainGoal.id,
      userId: request.userId,
      status: 'sent',
    });

    return true;
  }

  /** Prioridade: follow-up/last_chance > operacionais; dentro do grupo, a mais antiga/atrasada */
  private pickMainGoal(goals: ReminderGoalRecord[]): ReminderGoalRecord {
    const followUp = goals.filter(
      (g) =>
        g.dailyStatus === 'WAITING_OPERATIONAL_REPLY' ||
        g.dailyStatus === 'WAITING_FOLLOW_UP_REPLY',
    );
    const candidates = followUp.length > 0 ? followUp : goals;
    return candidates.reduce((a, b) => {
      const aSent = a.lastReminderSentAt ? new Date(a.lastReminderSentAt).getTime() : 0;
      const bSent = b.lastReminderSentAt ? new Date(b.lastReminderSentAt).getTime() : 0;
      if (aSent > 0 && bSent > 0) return aSent < bSent ? a : b;
      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      return aCreated < bCreated ? a : b;
    });
  }

  private async buildMessageConsolidated(
    mainGoal: ReminderGoalRecord,
    batchGoals: ReminderGoalRecord[],
    kind: ReminderKind,
    timezone: string,
  ): Promise<string> {
    // Excluir só a meta principal — as outras do batch aparecem em "Além disso, metas pendentes"
    const excludeIds = [mainGoal.id];
    return this.buildMessageInternal(mainGoal, kind, timezone, excludeIds);
  }

  private async buildMessage(
    goal: ReminderGoalRecord,
    kind: ReminderKind,
    timezone: string,
  ) {
    return this.buildMessageInternal(goal, kind, timezone, [goal.id]);
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

    const goalsWithStatus = await this.userGoalService.getGoalsForTodayWithStatus(
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
        reminderTime: goal.reminderTime
          ? new Date(goal.reminderTime).toISOString()
          : undefined,
        reminderCount: goal.reminderCount || 0,
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
    const pendentesTitles = ignoredGoals.slice(0, MAX_PENDENTES).map((g) => g.title);
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
    // Progresso hoje só em follow-up/last_chance/reactivation — não na primeira msg (operational)
    const isFirstReminder = kind === 'operational';
    if (totalCount > 1 && !isFirstReminder) {
      msg += `\n\nProgresso hoje: ${doneCount}/${totalCount} metas concluídas`;
    }

    return msg;
  }
}
