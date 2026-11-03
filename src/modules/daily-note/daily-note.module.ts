import { Module } from '@nestjs/common';
import { AiModule } from '../ia/ai.module';
import { UserGoalModule } from '../goals/user-goal.module';
import { DailyNoteController } from './daily-note.controller';
import { DailyNoteService } from './daily-note.service';

@Module({
  imports: [AiModule, UserGoalModule],
  controllers: [DailyNoteController],
  providers: [DailyNoteService],
})
export class DailyNoteModule {}
