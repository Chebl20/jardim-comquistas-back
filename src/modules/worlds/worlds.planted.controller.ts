import { Controller, Get, Delete, Param, Query, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { prisma } from '../../prisma/client';
import { StorageService } from '../../storage/storage.service';

@ApiTags('Mundos — Árvores Plantadas')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsPlantedController {
  constructor(private readonly storageService: StorageService) {}

  @Get(':id/planted-trees')
  @ApiOperation({ summary: 'Listar árvores plantadas', description: 'Retorna as árvores plantadas do usuário autenticado no mundo especificado.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiQuery({ name: 'anchorId', required: false })
  @ApiQuery({ name: 'treeCatalogId', required: false })
  @ApiQuery({ name: 'stage', required: false, description: 'Estágio de crescimento' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limite de resultados (padrão: 100)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Offset para paginação' })
  @ApiResponse({ status: 200, description: 'Lista de árvores plantadas.' })
  async listPlantedTrees(
    @Param('id') id: string,
    @Req() req: any,
    @Query('anchorId') anchorId?: string,
    @Query('treeCatalogId') treeCatalogId?: string,
    @Query('stage') stage?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('userId não encontrado no contexto da requisição');

    const where: any = { 
      worldId: safeId,
      OR: [
        { goal: { userId } }
      ]
    };
    if (anchorId) where.anchorId = String(anchorId).trim();
    if (treeCatalogId) where.treeCatalogId = String(treeCatalogId).trim();
    if (stage !== undefined) {
      const s = Number(stage);
      if (!Number.isNaN(s)) where.actualStage = s;
    }

    const take = Math.min(1000, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);

    const rows = await (prisma as any).plantedTree.findMany({
      where,
      include: { treeCatalog: true, growthEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const total = await (prisma as any).plantedTree.count({ where });
    const plantedTrees = await Promise.all(rows.map((row: any) => this.storageService.signPlantedTree(row)));

    return { plantedTrees, total };
  }

  @Delete(':id/planted-trees/:plantedTreeId')
  @ApiOperation({ summary: 'Deletar árvore plantada', description: 'Remove uma árvore plantada específica com seus eventos e metas associadas.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiParam({ name: 'plantedTreeId', description: 'ID da árvore plantada' })
  @ApiResponse({ status: 200, description: 'Árvore removida.' })
  async deletePlantedTreeById(@Param('id') id: string, @Param('plantedTreeId') plantedTreeId: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const pid = String(plantedTreeId || '').trim();
    if (!pid) throw new BadRequestException('invalid plantedTree id');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const planted = await tx.plantedTree.findUnique({ where: { id: pid } });
      if (!planted) throw new BadRequestException('planted tree not found');
      if (planted.worldId !== safeId) throw new BadRequestException('planted tree does not belong to this world');

      await tx.goal.deleteMany({ where: { plantedTreeId: pid } });
      await tx.goal.deleteMany({ where: { plantedTreeId: pid } });

      const deletedEvents = await tx.growthEvent.deleteMany({ where: { plantedTreeId: pid } });
      await tx.plantedTree.delete({ where: { id: pid } });
      return { ok: true, deletedPlantedTreeId: pid, deletedEvents: deletedEvents.count ?? deletedEvents };
    });

    return out;
  }

  @Delete(':id/planted-trees')
  @ApiOperation({ summary: 'Limpar todas as árvores plantadas', description: 'Remove todas as árvores plantadas de um mundo. Requer confirm=1.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiQuery({ name: 'confirm', required: true, description: 'Confirmação (1 ou true)' })
  @ApiResponse({ status: 200, description: 'Árvores removidas.' })
  async clearPlantedTrees(@Param('id') id: string, @Query('confirm') confirm?: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const doClear = confirm === '1' || confirm === 'true';
    if (!doClear) throw new BadRequestException('confirm=1 is required to clear planted trees');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const plantedRows = await tx.plantedTree.findMany({ where: { worldId: safeId }, select: { id: true } });
      const ids = (plantedRows || []).map((r: any) => r.id);
      if (!ids.length) return { ok: true, deletedPlantedTrees: 0, deletedEvents: 0 };

      await tx.goal.deleteMany({ where: { plantedTreeId: { in: ids } } });
      await tx.goal.deleteMany({ where: { plantedTreeId: { in: ids } } });

      const deletedEvents = await tx.growthEvent.deleteMany({ where: { plantedTreeId: { in: ids } } });
      const deletedPlanted = await tx.plantedTree.deleteMany({ where: { id: { in: ids } } });
      return { ok: true, deletedPlantedTrees: deletedPlanted.count ?? deletedPlanted, deletedEvents: deletedEvents.count ?? deletedEvents };
    });

    return out;
  }
}

export default WorldsPlantedController;
