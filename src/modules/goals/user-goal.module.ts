import { Module } from '@nestjs/common';
import { UserGoalService } from './user-goal.service';
import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';
import { UserGoalController, GoalInstanceController } from './user-goal.controller';

@Module({
  imports: [WorldsModule, SharedModule],
  controllers: [UserGoalController, GoalInstanceController],
  providers: [UserGoalService],
  exports: [UserGoalService],
})
export class UserGoalModule {}
