import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GoalsModule } from './goals/goals.module';
import { WorldsController } from './worlds/worlds.controller';
import { WorldsConfigService } from './worlds/worlds-config.service';

@Module({
  imports: [GoalsModule],
  controllers: [AppController, WorldsController],
  providers: [AppService, WorldsConfigService],
})
export class AppModule {}
