import { Module } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RateLimiterService } from './rate-limiter.service';
import { PendingActionService } from './pending-action.service';

@Module({
  providers: [CommunicationService, RateLimiterService, PendingActionService],
  exports: [CommunicationService, RateLimiterService, PendingActionService],
})
export class SharedModule {}