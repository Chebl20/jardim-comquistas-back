import { UserGoalModule } from './modules/goals/user-goal.module';
import { UserModule } from './modules/users/user.module';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WorldsConfigService } from './modules/worlds/worlds-config.service';
import { SupabaseService } from './supabase/supabase.service';
import { TreesImportService } from './modules/worlds/trees-import.service';
import { WorldsSvgController } from './modules/worlds/worlds.svg.controller';
import { WorldsAnchorsController } from './modules/worlds/worlds.anchors.controller';
import { WorldsTreesController } from './modules/worlds/worlds.trees.controller';
import { WorldsPlantedController } from './modules/worlds/worlds.planted.controller';
import { WorldsEventsController } from './modules/worlds/worlds.events.controller';
import { WorldsGateway } from './modules/worlds/worlds.gateway';
import { WorldsEventsService } from './modules/worlds/worlds.events.service';

import { TelegramModule } from './modules/telegram/telegram.module';
import { AiModule } from './modules/ia/openIa/ai.module';
;

@Module({
  imports: [TelegramModule, AiModule, UserGoalModule, UserModule],
  controllers: [HealthController, WorldsSvgController, WorldsAnchorsController, WorldsTreesController, WorldsPlantedController, WorldsEventsController],
  providers: [WorldsConfigService, SupabaseService, TreesImportService, WorldsGateway, WorldsEventsService],
})
export class AppModule {}
