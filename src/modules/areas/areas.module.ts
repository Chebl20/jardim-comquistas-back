import { Module } from '@nestjs/common';
import { AreasController } from './areas.controller';

@Module({
  controllers: [AreasController],
})
export class AreasModule {}
