import { Module } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RateLimiterService } from './rate-limiter.service';
import { PendingActionService } from './pending-action.service';
import { ConversationSessionService } from './conversation-session.service';

@Module({
  providers: [CommunicationService, RateLimiterService, PendingActionService, ConversationSessionService],
  exports: [CommunicationService, RateLimiterService, PendingActionService, ConversationSessionService],
})
export class SharedModule {}