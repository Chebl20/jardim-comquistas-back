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

@Module({
  imports: [],
  controllers: [AppController, WorldsSvgController, WorldsAnchorsController, WorldsTreesController, WorldsPlantedController, WorldsEventsController, TestSupabaseController],
  providers: [AppService, WorldsConfigService, SupabaseService, TreesImportService, WorldsGateway],
})
export class AppModule {}
