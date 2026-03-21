import { Controller, Get, Post, Delete, Param, Body, BadRequestException, Query, UseGuards } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { WorldsEventsService } from './worlds.events.service';
import { CreateGrowthEventDto } from './dto/create-growth-event.dto';
import { ProgressPlantedTreeDto } from './dto/progress-planted-tree.dto';
import { prisma } from '../../prisma/client';

@ApiTags('Mundos — Eventos e Progressão')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsEventsController {
  constructor(private readonly worldsEventsService: WorldsEventsService) {}

  @Get(':id/trees/:anchorId')
  @ApiOperation({ summary: 'Obter progressão de árvore', description: 'Retorna a progressão de uma árvore específica em um anchor.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiParam({ name: 'anchorId', description: 'ID do anchor' })
  @ApiResponse({ status: 200, description: 'Progressão retornada.' })
  async getTreeProgression(@Param('id') id: string, @Param('anchorId') anchorId: string) {
    return this.worldsEventsService.getTreeProgression(id, anchorId);
  }

  @Post(':id/trees/progression')
  @ApiOperation({ summary: 'Obter progressão por body', description: 'Retorna a progressão de árvore especificando anchorId no body.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiResponse({ status: 200, description: 'Progressão retornada.' })
  async getTreeProgressionByBody(@Param('id') id: string, @Body() body: { anchorId?: string }) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const aid = String(body?.anchorId || '').trim();
    if (!aid) throw new BadRequestException('invalid anchor id in body');

    return this.getTreeProgression(id, aid);
  }

  @Post(':id/trees/events')
  @ApiOperation({ summary: 'Criar evento de crescimento', description: 'Cria um evento de crescimento para uma árvore no mundo — vincula árvore do catálogo a um anchor.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiResponse({ status: 201, description: 'Evento criado.' })
  async createGrowthEventByCatalog(
    @Param('id') id: string,
    @Body() body: CreateGrowthEventDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('userId não encontrado no contexto da requisição');
    const bodyWithUser = { ...body, userId };
    return this.worldsEventsService.createGrowthEventByCatalog(id, bodyWithUser);
  }

  @Post(':id/planted-trees/progress')
  @ApiOperation({ summary: 'Progredir árvore plantada', description: 'Avança o estágio de crescimento de uma árvore plantada.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiResponse({ status: 201, description: 'Árvore progredida.' })
  async progressPlantedTreeByBody(
    @Param('id') id: string,
    @Body() body: ProgressPlantedTreeDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.userId;
    const bodyWithUser = { ...body, userId };
    return this.worldsEventsService.progressPlantedTree(id, bodyWithUser as any);
  }

  @Post('planted-trees/progress')
  @ApiOperation({ summary: 'Progredir árvore plantada (global)', description: 'Avança o estágio de crescimento de uma árvore plantada sem especificar mundo.' })
  @ApiResponse({ status: 201, description: 'Árvore progredida.' })
  async progressPlantedTreeGlobal(
    @Body() body: ProgressPlantedTreeDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.userId;
    const { plantedTreeId } = body;
    if (!plantedTreeId) throw new BadRequestException('plantedTreeId required');

    const planted = await (prisma as any).plantedTree.findUnique({ where: { id: plantedTreeId } });
    if (!planted) throw new BadRequestException('planted tree not found');

    const goal = await (prisma as any).userGoal.findFirst({ where: { plantedTreeId, userId } });
    if (!goal) throw new BadRequestException('planted tree does not belong to user');

    const worldId = planted.worldId;
    const bodyWithUser = { ...body, userId };
    return this.worldsEventsService.progressPlantedTree(worldId, bodyWithUser as any);
  }
}
