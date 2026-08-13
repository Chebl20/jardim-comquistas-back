import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ReminderObservabilityService {
  private readonly logger = new Logger(ReminderObservabilityService.name);

  policy(event: Record<string, unknown>) {
    this.logger.debug(`reminder_policy ${JSON.stringify(event)}`);
  }

  delivery(event: Record<string, unknown>) {
    this.logger.debug(`reminder_delivery ${JSON.stringify(event)}`);
  }

  reply(event: Record<string, unknown>) {
    this.logger.debug(`reminder_reply ${JSON.stringify(event)}`);
  }
}
