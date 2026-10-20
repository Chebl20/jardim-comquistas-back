import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConversationTurnService } from './conversation-turn.service';
import { DistributedLockService } from './distributed-lock.service';

@Injectable()
export class ConversationRetentionService {
  private readonly logger = new Logger(ConversationRetentionService.name);

  constructor(
    private readonly turns: ConversationTurnService,
    private readonly locks: DistributedLockService,
  ) {}

  @Cron('15 3 * * *')
  async purgeExpiredTurns() {
    if (!(await this.locks.tryAcquire('conversation:retention:lock', 600)))
      return;
    try {
      const count = await this.turns.purgeExpired();
      if (count > 0) {
        this.logger.log(`Purged ${count} expired conversation turns`);
      }
    } finally {
      await this.locks.release('conversation:retention:lock');
    }
  }
}
