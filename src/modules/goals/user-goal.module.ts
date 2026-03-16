import { Module } from '@nestjs/common';
import { UserGoalService } from './user-goal.service';
import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [WorldsModule, SharedModule],
  providers: [UserGoalService],
  exports: [UserGoalService],
})
export class UserGoalModule {}
