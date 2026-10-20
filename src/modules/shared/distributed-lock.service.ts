import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private redis: Redis | null = null;
  private readonly memoryLocks = new Map<string, number>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        this.redis = new Redis(url);
      } catch (e) {
        this.logger.warn('Redis indisponível para locks', e);
        this.redis = null;
      }
    }
  }

  /**
   * Tenta adquirir lock exclusivo. Retorna true se adquirido.
   */
  async tryAcquire(key: string, ttlSec = 60): Promise<boolean> {
    if (this.redis) {
      try {
        const res = await this.redis.set(key, '1', 'EX', ttlSec, 'NX');
        return res === 'OK';
      } catch (e) {
        this.logger.warn('Redis lock falhou, usando memória', e);
      }
    }

    const now = Date.now();
    const expires = this.memoryLocks.get(key);
    if (expires && expires > now) return false;
    this.memoryLocks.set(key, now + ttlSec * 1000);
    return true;
  }

  async release(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (_) {}
    }
    this.memoryLocks.delete(key);
  }
}
