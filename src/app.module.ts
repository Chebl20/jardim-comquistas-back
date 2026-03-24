import { UserGoalModule } from './modules/goals/user-goal.module';
import { UserModule } from './modules/users/user.module';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WorldsModule } from './modules/worlds/worlds.module';
import { SharedModule } from './modules/shared/shared.module';

import { TelegramModule } from './modules/telegram/telegram.module';
import { AiModule } from './modules/ia/ai.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ReminderModule } from './modules/reminder/reminder.module';
;

import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProgressModule } from './modules/progress/progress.module';
import { AreasModule } from './modules/areas/areas.module';
import { EventsModule } from './modules/events/events.module';

@Module({
  imports: [ScheduleModule.forRoot(), TelegramModule, AiModule, UserGoalModule, UserModule, ReminderModule, SharedModule, WorldsModule, DashboardModule, ProgressModule, AreasModule, EventsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
