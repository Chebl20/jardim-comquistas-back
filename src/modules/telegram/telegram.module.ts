import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { InboundModule } from '../inbound/inbound.module';

@Module({
  imports: [forwardRef(() => InboundModule)],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
