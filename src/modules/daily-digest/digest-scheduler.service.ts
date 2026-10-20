import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { DailyDigestService } from './daily-digest.service';
import { DistributedLockService } from '../shared/distributed-lock.service';
@Injectable()
export class DigestSchedulerService {
  private readonly logger = new Logger(DigestSchedulerService.name);
  private lastSentKey = new Map<string, string>();

  constructor(
    private readonly digest: DailyDigestService,
    private readonly locks: DistributedLockService,
  ) {}

  @Cron('* * * * *')
  async sendScheduledDigests() {
    if (!(await this.locks.tryAcquire('digest:tick:lock', 55))) return;
    try {
      const users = await prisma.user.findMany({
        where: { digestEnabled: true, digestTime: { not: null } },
        select: {
          id: true,
          digestTime: true,
          timezone: true,
        },
      });

      for (const user of users) {
        if (!user.digestTime) continue;
        const tz = user.timezone || 'America/Sao_Paulo';
        const now = DateTime.now().setZone(tz);
        const [hh, mm] = user.digestTime.split(':').map((p) => parseInt(p, 10));
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
        if (now.hour !== hh || now.minute !== mm) continue;

        const dayKey = now.toFormat('yyyy-MM-dd');
        const cacheKey = `${user.id}:${dayKey}`;
        if (this.lastSentKey.get(user.id) === dayKey) continue;

        try {
          const sent = await this.digest.sendDigestForUser(user.id);
          if (sent) {
            this.lastSentKey.set(user.id, dayKey);
          }
        } catch (e) {
          this.logger.warn(`digest failed user=${user.id}`, e);
        }
      }
    } finally {
      await this.locks.release('digest:tick:lock');
    }
  }
}
