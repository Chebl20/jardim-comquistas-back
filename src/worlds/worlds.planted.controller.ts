import { Controller, Get, Delete, Param, Query, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { prisma } from '../prisma/client';

@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsPlantedController {
  @Get(':id/planted-trees')
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


    // Filtro por userId (cada usuário só vê suas árvores)
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('userId não encontrado no contexto da requisição');

    const where: any = { worldId: safeId };
    where.userGoals = { some: { userId } };
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

    return { plantedTrees: rows, total };
  }

  @Delete(':id/planted-trees/:plantedTreeId')
  async deletePlantedTreeById(@Param('id') id: string, @Param('plantedTreeId') plantedTreeId: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const pid = String(plantedTreeId || '').trim();
    if (!pid) throw new BadRequestException('invalid plantedTree id');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const planted = await tx.plantedTree.findUnique({ where: { id: pid } });
      if (!planted) throw new BadRequestException('planted tree not found');
      if (planted.worldId !== safeId) throw new BadRequestException('planted tree does not belong to this world');

      // Deletar UserGoal associado antes de deletar a árvore
      await tx.userGoal.deleteMany({ where: { plantedTreeId: pid } });

      const deletedEvents = await tx.growthEvent.deleteMany({ where: { plantedTreeId: pid } });
      await tx.plantedTree.delete({ where: { id: pid } });
      return { ok: true, deletedPlantedTreeId: pid, deletedEvents: deletedEvents.count ?? deletedEvents };
    });

    return out;
  }

  @Delete(':id/planted-trees')
  async clearPlantedTrees(@Param('id') id: string, @Query('confirm') confirm?: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const doClear = confirm === '1' || confirm === 'true';
    if (!doClear) throw new BadRequestException('confirm=1 is required to clear planted trees');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const plantedRows = await tx.plantedTree.findMany({ where: { worldId: safeId }, select: { id: true } });
      const ids = (plantedRows || []).map((r: any) => r.id);
      if (!ids.length) return { ok: true, deletedPlantedTrees: 0, deletedEvents: 0 };

      // Deletar UserGoal associados antes de deletar as árvores
      await tx.userGoal.deleteMany({ where: { plantedTreeId: { in: ids } } });

      const deletedEvents = await tx.growthEvent.deleteMany({ where: { plantedTreeId: { in: ids } } });
      const deletedPlanted = await tx.plantedTree.deleteMany({ where: { id: { in: ids } } });
      return { ok: true, deletedPlantedTrees: deletedPlanted.count ?? deletedPlanted, deletedEvents: deletedEvents.count ?? deletedEvents };
    });

    return out;
  }
}

export default WorldsPlantedController;
