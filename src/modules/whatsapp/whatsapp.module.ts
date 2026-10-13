import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { EvolutionController } from './evolution.controller';
import { EvolutionClient } from './evolution.client';
import { InboundModule } from '../inbound/inbound.module';

@Module({
  imports: [forwardRef(() => InboundModule)],
  controllers: [WhatsAppController, EvolutionController],
  providers: [WhatsAppService, EvolutionClient],
  exports: [WhatsAppService, EvolutionClient],
})
export class WhatsappModule {}
