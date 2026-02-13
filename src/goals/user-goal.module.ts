import { Module, forwardRef } from '@nestjs/common';
import { UserGoalService } from './user-goal.service';
import { WorldsGateway } from '../worlds/worlds.gateway';

@Module({
  providers: [UserGoalService, WorldsGateway],
  exports: [UserGoalService],
})
export class UserGoalModule {}
