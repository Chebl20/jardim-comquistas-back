import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GoalsModule } from './goals/goals.module';

@Module({
  imports: [GoalsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
