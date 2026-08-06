import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WuzapiClient } from './wuzapi.client';
import { AiModule } from '../ia/ai.module';
import { UserModule } from '../users/user.module';
import { SharedModule } from '../shared/shared.module';
import { UserGoalModule } from '../goals/user-goal.module';
import { DailyDigestModule } from '../daily-digest/daily-digest.module';

@Module({
  imports: [
    AiModule,
    forwardRef(() => UserModule),
    SharedModule,
    UserGoalModule,
    forwardRef(() => DailyDigestModule),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WuzapiClient],
  exports: [WhatsAppService, WuzapiClient],
})
export class WhatsappModule {}
