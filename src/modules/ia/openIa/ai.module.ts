import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { IntentRouter } from '../intent-router.service';
import { RulesService } from '../rules.service';

import { UserGoalModule } from '../../goals/user-goal.module';

import { WorldsModule } from '../../worlds/worlds.module';
import { SharedModule } from '../../shared/shared.module';

@Module({
  imports: [UserGoalModule, SharedModule, WorldsModule],
  providers: [
    AiService,
    IntentRouter,
    RulesService,
  ],
  exports: [AiService, IntentRouter],
})
export class AiModule {}
