import { Module, forwardRef } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RateLimiterService } from './rate-limiter.service';
import { ConversationSessionService } from './conversation-session.service';
import { AiModule } from '../ia/ai.module';

@Module({
  imports: [forwardRef(() => AiModule)],
  providers: [
    CommunicationService,
    RateLimiterService,
    ConversationSessionService,
  ],
  exports: [
    CommunicationService,
    RateLimiterService,
    ConversationSessionService,
  ],
})
export class SharedModule {}
