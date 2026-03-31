import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { UserGoalModule } from '../goals/user-goal.module';

@Module({
  imports: [UserGoalModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
