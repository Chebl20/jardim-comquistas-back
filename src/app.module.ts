import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorldsController } from './worlds/worlds.controller';
import { WorldsConfigService } from './worlds/worlds-config.service';
import { SupabaseService } from './supabase/supabase.service';
import { TestSupabaseController } from './supabase/test-supabase.controller';

@Module({
    imports: [],
  controllers: [AppController, WorldsController, TestSupabaseController],
  providers: [AppService, WorldsConfigService, SupabaseService],
})
export class AppModule {}
