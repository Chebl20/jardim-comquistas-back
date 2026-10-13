import { UserGoalModule } from './modules/goals/user-goal.module';
import { UserModule } from './modules/users/user.module';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { HealthController } from './health.controller';
import { WorldsModule } from './modules/worlds/worlds.module';
import { SharedModule } from './modules/shared/shared.module';

import { TelegramModule } from './modules/telegram/telegram.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { DailyDigestModule } from './modules/daily-digest/daily-digest.module';
import { AiModule } from './modules/ia/ai.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ReminderModule } from './modules/reminder/reminder.module';

import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProgressModule } from './modules/progress/progress.module';
import { AreasModule } from './modules/areas/areas.module';
import { EventsModule } from './modules/events/events.module';
import { StorageModule } from './storage/storage.module';
import { PrismaModule } from './prisma/prisma.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema.prefs({ abortEarly: false }),
    }),
    PrismaModule,
    StorageModule,
    ScheduleModule.forRoot(),
    TelegramModule,
    WhatsappModule,
    MessagingModule,
    DailyDigestModule,
    AiModule,
    UserGoalModule,
    UserModule,
    ReminderModule,
    SharedModule,
    WorldsModule,
    DashboardModule,
    ProgressModule,
    AreasModule,
    EventsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
