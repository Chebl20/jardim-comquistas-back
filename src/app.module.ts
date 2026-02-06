import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GoalsModule } from './goals/goals.module';
import { WorldsController } from './worlds/worlds.controller';

@Module({
  imports: [GoalsModule],
  controllers: [AppController, WorldsController],
  providers: [AppService],
})
export class AppModule {}
