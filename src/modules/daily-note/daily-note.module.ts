import { Module } from '@nestjs/common';
import { AiModule } from '../ia/ai.module';
import { UserGoalModule } from '../goals/user-goal.module';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { DailyNoteController } from './daily-note.controller';
import { DailyNoteService } from './daily-note.service';

@Module({
  imports: [AiModule, UserGoalModule],
  controllers: [DailyNoteController],
  providers: [DailyNoteService, DistributedLockService],
})
export class DailyNoteModule {}
