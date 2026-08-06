import { Module, forwardRef } from '@nestjs/common';
import { DailyDigestService } from './daily-digest.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [UserGoalModule, forwardRef(() => MessagingModule)],
  providers: [DailyDigestService],
  exports: [DailyDigestService],
})
export class DailyDigestModule {}
