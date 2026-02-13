import { UserGoalService } from '../../goals/user-goal.service';
import { SupabaseService } from '../../../supabase/supabase.service';

import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { IntentRouter } from '../intent-router.service';
import { WorldsEventsService } from '../../worlds/worlds.events.service';
import { WorldsConfigService } from '../../worlds/worlds-config.service';
import { TreesImportService } from '../../worlds/trees-import.service';
import { WorldsGateway } from '../../worlds/worlds.gateway';

@Module({
  providers: [
    AiService,
    IntentRouter,
    WorldsEventsService,
    WorldsConfigService,
    TreesImportService,
    WorldsGateway,
    SupabaseService,
    UserGoalService,
  ],
  exports: [AiService, IntentRouter],
})
export class AiModule {}
