import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';
import { AiModule } from '../ia/ai.module';
import { UserModule } from '../users/user.module';
import { SharedModule } from '../shared/shared.module';
import { UserGoalModule } from '../goals/user-goal.module';

@Module({
  imports: [AiModule, UserModule, SharedModule, UserGoalModule],
  providers: [TelegramService, DailyDigestService],
  exports: [TelegramService],
})
export class TelegramModule {}
