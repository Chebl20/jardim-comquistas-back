import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserGoalModule } from '../goals/user-goal.module';

@Module({
  imports: [UserGoalModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
