import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { Goal } from './goals.interface';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Post()
  async create(@Body() body: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>) {
    return await this.goalsService.create(body);
  }

  @Get()
  async findAll() {
    return await this.goalsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.goalsService.findOne(+id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updates: Partial<Goal>) {
    return await this.goalsService.update(+id, updates);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.goalsService.delete(+id);
  }
}
