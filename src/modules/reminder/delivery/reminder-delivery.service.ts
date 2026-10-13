import { Injectable } from '@nestjs/common';
import { ReminderObservabilityService } from '../observability/reminder-observability.service';
import { MessagingService } from '../../messaging/messaging.service';
import type { ReminderKind } from '../reminder.types';

export type ReminderSendRequest = {
  user: {
    telegramId: string | null;
    whatsappId?: string | null;
    preferredChannel?: string | null;
  } | null;
  text: string;
  kind: ReminderKind;
  goalId: string;
  userId: string;
};

@Injectable()
export class ReminderDeliveryService {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly observability: ReminderObservabilityService,
  ) {}

  async send(request: ReminderSendRequest): Promise<boolean> {
    const { user, text, kind, goalId, userId } = request;
    const messagingUser = user ? { id: userId, ...user } : null;
    if (!messagingUser || !this.messagingService.hasAnyChannel(messagingUser)) {
      this.observability.delivery({
        kind,
        goalId,
        userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    const sent = await this.messagingService.sendToUser(
      messagingUser,
      text,
      'reminder',
    );
    if (!sent) {
      this.observability.delivery({
        kind,
        goalId,
        userId,
        status: 'skipped',
        reason: 'missing_channel',
      });
      return false;
    }

    this.observability.delivery({
      kind,
      goalId,
      userId,
      status: 'sent',
    });
    return true;
  }
}
