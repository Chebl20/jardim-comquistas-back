import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

type CheckResult = { allowed: boolean; remaining: number; retryAfter?: number };

@Injectable()
export class RateLimiterService {
  private redis: Redis | null = null;
  private logger = new Logger(RateLimiterService.name);
  private inMemory = new Map<string, { count: number; expiresAt: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        this.redis = new Redis(url);
      } catch (e) {
        this.logger.warn(
          'Falha ao conectar Redis, usando fallback in-memory',
          e,
        );
        this.redis = null;
      }
    }
  }

  async isAllowed(
    key: string,
    limit = 5,
    windowSec = 60,
  ): Promise<CheckResult> {
    if (this.redis) {
      try {
        const window = Math.floor(Date.now() / 1000 / windowSec);
        const redisKey = `rate:${key}:${window}`;
        const cnt = await this.redis.incr(redisKey);
        if (cnt === 1) await this.redis.expire(redisKey, windowSec);
        const ttl = await this.redis.ttl(redisKey);
        if (cnt <= limit)
          return { allowed: true, remaining: Math.max(0, limit - cnt) };
        return { allowed: false, remaining: 0, retryAfter: ttl || windowSec };
      } catch (e) {
        this.logger.warn(
          'Erro Redis no rate limiter, usando fallback in-memory',
          e,
        );
      }
    }

    // fallback in-memory
    const now = Date.now();
    const entry = this.inMemory.get(key);
    if (!entry || entry.expiresAt < now) {
      this.inMemory.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
      return { allowed: true, remaining: limit - 1 };
    }
    entry.count += 1;
    this.inMemory.set(key, entry);
    if (entry.count <= limit)
      return { allowed: true, remaining: Math.max(0, limit - entry.count) };
    const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
}
