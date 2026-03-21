import { Module } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RateLimiterService } from './rate-limiter.service';
import { ConversationSessionService } from './conversation-session.service';

@Module({
  providers: [CommunicationService, RateLimiterService, ConversationSessionService],
  exports: [CommunicationService, RateLimiterService, ConversationSessionService],
})
export class SharedModule {}