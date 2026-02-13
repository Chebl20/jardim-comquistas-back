

import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AiModule } from '../ia/openIa/ai.module';
import { UserModule } from '../users/user.module';

@Module({
  imports: [AiModule, UserModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
