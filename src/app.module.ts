import { UserGoalModule } from './goals/user-goal.module';
import { UserModule } from './users/user.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorldsConfigService } from './worlds/worlds-config.service';
import { SupabaseService } from './supabase/supabase.service';
import { TestSupabaseController } from './supabase/test-supabase.controller';
import { TreesImportService } from './worlds/trees-import.service';
import { WorldsSvgController } from './worlds/worlds.svg.controller';
import { WorldsAnchorsController } from './worlds/worlds.anchors.controller';
import { WorldsTreesController } from './worlds/worlds.trees.controller';
import { WorldsPlantedController } from './worlds/worlds.planted.controller';
import { WorldsEventsController } from './worlds/worlds.events.controller';
import { WorldsGateway } from './worlds/worlds.gateway';
import { WorldsEventsService } from './worlds/worlds.events.service';

import { TelegramModule } from './telegram/telegram.module';
import { AiModule } from './ia/openIa/ai.module';
;

@Module({
  imports: [TelegramModule, AiModule, UserGoalModule, UserModule],
  controllers: [AppController, WorldsSvgController, WorldsAnchorsController, WorldsTreesController, WorldsPlantedController, WorldsEventsController, TestSupabaseController],
  providers: [AppService, WorldsConfigService, SupabaseService, TreesImportService, WorldsGateway, WorldsEventsService],
})
export class AppModule {}
