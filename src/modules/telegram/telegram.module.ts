

import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { CommunicationService } from '../shared/communication.service';
import { AiModule } from '../ia/openIa/ai.module';
import { UserModule } from '../users/user.module';

@Module({
  imports: [AiModule, UserModule],
  providers: [TelegramService, CommunicationService],
  exports: [TelegramService, CommunicationService],
})
export class TelegramModule {}
