import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ReminderNucleus } from '../ia/nuclei/reminder';
import { ConversationSessionService } from '../shared/conversation-session.service';
import { FLOW_STATES } from '../ia/conversation/flow.types';
import { TelegramService } from '../telegram/telegram.service';
import {
  ReminderDeliveryRequest,
  ReminderGoalRecord,
  ReminderKind,
  ReminderSessionContext,
} from './reminder.types';
import { ReminderObservabilityService } from './reminder-observability.service';

@Injectable()
export class ReminderDeliveryService {
  private readonly reminderSessionTtlMinutes = Number(
    process.env.REMINDER_SESSION_TTL_MINUTES || 180,
  );

  constructor(
    private readonly telegramService: TelegramService,
    private readonly reminderNucleus: ReminderNucleus,
    private readonly conversationSession: ConversationSessionService,
    private readonly observability: ReminderObservabilityService,
  ) {}

  async deliver(request: ReminderDeliveryRequest) {
    const user = request.goal.user;
    if (!user?.telegramId) {
      this.observability.delivery({
        kind: request.kind,
        goalId: request.goal.id,
        userId: request.goal.userId,
        status: 'skipped',
        reason: 'missing_telegram',
      });
      return false;
    }

    const message = await this.buildMessage(request.goal, request.kind, request.timezone);
    await this.telegramService.sendReply(
      Number(user.telegramId),
      message,
      'reminder',
    );

    const reminderContext: ReminderSessionContext = {
      reminderKind: request.kind,
      pendingGoalId: request.goal.id,
      pendingGoalTitle: request.goal.title,
      pendingGoalDescription: request.goal.description || '',
      goalType: request.goal.goalType,
      reminderTime: request.goal.reminderTime
        ? new Date(request.goal.reminderTime).toISOString()
        : null,
      reminderCount: request.goal.reminderCount,
      timezone: request.timezone,
      sentAt: request.sentAt.toISOString(),
    };

    await this.conversationSession.upsertSessionState(
      request.goal.userId,
      FLOW_STATES.REMINDER,
      {
        lastBotOrigin: 'reminder',
        pendingGoalId: request.goal.id,
        pendingGoalTitle: request.goal.title,
        pendingGoalDescription: request.goal.description || '',
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

  private async buildMessage(
    goal: ReminderGoalRecord,
    kind: ReminderKind,
    timezone: string,
  ) {
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

    const result = await this.reminderNucleus.analyze({
      userId: goal.userId,
      currentSession: FLOW_STATES.REMINDER,
      text: '',
      meta: {
        userName: goal.user?.name,
        goalId: goal.id,
        goalTitle: goal.title,
        goalDescription: goal.description || '',
        goalType: goal.goalType as 'Pontual' | 'Continua',
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
      },
    });

    return (result.actions[0] as { text?: string } | undefined)?.text || goal.title;
  }
}
