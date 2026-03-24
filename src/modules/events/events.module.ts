import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { UserGoalModule } from '../goals/user-goal.module';

@Module({
  imports: [UserGoalModule],
  controllers: [EventsController],
})
export class EventsModule {}
