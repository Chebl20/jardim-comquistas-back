import { Module } from '@nestjs/common';
import { UserGoalService } from './user-goal.service';
import { WorldsModule } from '../worlds/worlds.module';

@Module({
  imports: [WorldsModule],
  providers: [UserGoalService],
  exports: [UserGoalService],
})
export class UserGoalModule {}
