import { Module } from '@nestjs/common';
import { WorldsService } from './worlds.service';
import { WorldsConfigService } from './worlds-config.service';
import { TreesImportService } from './trees-import.service';
import { WorldsGateway } from './worlds.gateway';
import { WorldsEventsService } from './worlds.events.service';
import { WorldsSvgController } from './worlds.svg.controller';
import { WorldsAnchorsController } from './worlds.anchors.controller';
import { WorldsTreesController } from './worlds.trees.controller';
import { WorldsPlantedController } from './worlds.planted.controller';
import { WorldsEventsController } from './worlds.events.controller';
import { SupabaseService } from '../../supabase/supabase.service';

@Module({
  providers: [WorldsService, WorldsConfigService, TreesImportService, WorldsGateway, WorldsEventsService, SupabaseService],
  controllers: [WorldsSvgController, WorldsAnchorsController, WorldsTreesController, WorldsPlantedController, WorldsEventsController],
  exports: [WorldsService, WorldsConfigService, TreesImportService, WorldsGateway, WorldsEventsService],
})
export class WorldsModule {}