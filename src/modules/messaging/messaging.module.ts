import { Module, forwardRef } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { TelegramModule } from '../telegram/telegram.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    forwardRef(() => TelegramModule),
    forwardRef(() => WhatsappModule),
  ],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
