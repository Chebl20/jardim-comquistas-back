import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { EvolutionController } from './evolution.controller';
import { EvolutionClient } from './evolution.client';
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
  controllers: [WhatsAppController, EvolutionController],
  providers: [WhatsAppService, EvolutionClient],
  exports: [WhatsAppService, EvolutionClient],
})
export class WhatsappModule {}
