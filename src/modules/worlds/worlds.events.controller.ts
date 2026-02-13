import { Controller, Get, Post, Delete, Param, Body, BadRequestException, Query, UseGuards } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { WorldsEventsService } from './worlds.events.service';
import { CreateGrowthEventDto } from './dto/create-growth-event.dto';
import { ProgressPlantedTreeDto } from './dto/progress-planted-tree.dto';

@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsEventsController {
  constructor(private readonly worldsEventsService: WorldsEventsService) {}

  @Get(':id/trees/:anchorId')
  async getTreeProgression(@Param('id') id: string, @Param('anchorId') anchorId: string) {
    // delega para o service
    return this.worldsEventsService.getTreeProgression(id, anchorId);
  }

  @Post(':id/trees/progression')
  async getTreeProgressionByBody(@Param('id') id: string, @Body() body: { anchorId?: string }) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const aid = String(body?.anchorId || '').trim();
    if (!aid) throw new BadRequestException('invalid anchor id in body');

    return this.getTreeProgression(id, aid);
  }

  @Post(':id/trees/events')
  async createGrowthEventByCatalog(
    @Param('id') id: string,
    @Body() body: CreateGrowthEventDto,
    @Req() req: any,
  ) {
    // Extrai userId do JWT (AuthGuard garante req.user)
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('userId não encontrado no contexto da requisição');
    // Garante que userId do JWT sempre será usado
    const bodyWithUser = { ...body, userId };
    return this.worldsEventsService.createGrowthEventByCatalog(id, bodyWithUser);
  }

  @Post(':id/planted-trees/progress')
  async progressPlantedTreeByBody(
    @Param('id') id: string,
    @Body() body: ProgressPlantedTreeDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.userId;
    const bodyWithUser = { ...body, userId };
    return this.worldsEventsService.progressPlantedTree(id, bodyWithUser as any);
  }
}
