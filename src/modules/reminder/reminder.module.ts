import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AiModule } from '../ia/openIa/ai.module';

@Module({
  imports: [UserGoalModule, TelegramModule, AiModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class ReminderModule {}