

import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AiModule } from '../ia/ai.module';
import { UserModule } from '../users/user.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [AiModule, UserModule, SharedModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
