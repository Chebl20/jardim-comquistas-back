import { Module, forwardRef } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { AiModule } from '../ia/ai.module';
import { SharedModule } from '../shared/shared.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ReminderPolicyModule } from './reminder-policy.module';
import { ReminderDeliveryService } from './delivery/reminder-delivery.service';
import { ReminderCopyBuilder } from './copy/reminder-copy.builder';
import { PrismaClaimStore } from './claim/prisma-claim.store';
import { REMINDER_CLAIM_STORE } from './claim/claim.store';

@Module({
  imports: [
    UserGoalModule,
    MessagingModule,
    forwardRef(() => AiModule),
    SharedModule,
    ReminderPolicyModule,
  ],
  providers: [
    ReminderService,
    ReminderCopyBuilder,
    ReminderDeliveryService,
    PrismaClaimStore,
    {
      provide: REMINDER_CLAIM_STORE,
      useExisting: PrismaClaimStore,
    },
  ],
  exports: [ReminderService],
})
export class ReminderModule {}
