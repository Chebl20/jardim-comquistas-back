import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoachTaskService } from './coach-task.service';
import { DistributedLockService } from '../shared/distributed-lock.service';

@Injectable()
export class CoachProactiveService {
  private readonly logger = new Logger(CoachProactiveService.name);

  constructor(
    private readonly coachTasks: CoachTaskService,
    private readonly locks: DistributedLockService,
  ) {}

  /** Domingo 09:00 UTC — cria tarefas de acompanhamento semanal. */
  @Cron('0 9 * * 0')
  async weeklyProgressScan() {
    const key = 'coach:weekly-progress:lock';
    if (!(await this.locks.tryAcquire(key, 3600))) return;
    try {
      await this.coachTasks.ensureWeeklyProgressTasks();
    } catch (e) {
      this.logger.warn('weeklyProgressScan failed', e);
    } finally {
      await this.locks.release(key);
    }
  }
}
