import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserLinkService } from './user-link.service';
import { UserLinkController } from './user-link.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [forwardRef(() => TelegramModule), forwardRef(() => WhatsappModule)],
  providers: [UserService, UserLinkService],
  controllers: [UserController, UserLinkController],
  exports: [UserService, UserLinkService],
})
export class UserModule {}
