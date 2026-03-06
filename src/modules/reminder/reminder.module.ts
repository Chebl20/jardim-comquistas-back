import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AiModule } from '../ia/ai.module';
import { SharedModule } from '../shared/shared.module';
import { ReminderPolicyEngine } from './reminder-policy.engine';
import { ReminderDeliveryService } from './reminder-delivery.service';
import { ReminderObservabilityService } from './reminder-observability.service';

@Module({
  imports: [UserGoalModule, TelegramModule, AiModule, SharedModule],
  providers: [
    ReminderService,
    ReminderPolicyEngine,
    ReminderDeliveryService,
    ReminderObservabilityService,
  ],
  exports: [ReminderService],
})
export class ReminderModule {}