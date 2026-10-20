import { Module } from '@nestjs/common';
import { CoachTaskService } from './coach-task.service';
import { CoachProactiveService } from './coach-proactive.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [CoachTaskService, CoachProactiveService],
  exports: [CoachTaskService],
})
export class CoachModule {}
