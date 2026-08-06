import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { AiModule } from '../ia/ai.module';
import { SharedModule } from '../shared/shared.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ReminderPolicyEngine } from './policy/reminder-policy.engine';
import { ReminderDeliveryService } from './delivery/reminder-delivery.service';
import { ReminderObservabilityService } from './observability/reminder-observability.service';

@Module({
  imports: [UserGoalModule, MessagingModule, AiModule, SharedModule],
  providers: [
    ReminderService,
    ReminderPolicyEngine,
    ReminderDeliveryService,
    ReminderObservabilityService,
  ],
  exports: [ReminderService],
})
export class ReminderModule {}
