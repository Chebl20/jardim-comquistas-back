import { Controller, Get, Post, Delete, Param, Body, BadRequestException, Query } from '@nestjs/common';
import { prisma } from '../prisma/client';
import { WorldsConfigService } from './worlds-config.service';
import { TreesImportService } from './trees-import.service';
import { WorldsGateway } from './worlds.gateway';

@Controller('api/worlds')
export class WorldsEventsController {
  constructor(
    private readonly configService: WorldsConfigService,
    private readonly importService: TreesImportService,
    private readonly gateway: WorldsGateway,
  ) {}

  @Get(':id/trees/:anchorId')
  async getTreeProgression(@Param('id') id: string, @Param('anchorId') anchorId: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const aid = String(anchorId || '').trim();
    if (!aid) throw new BadRequestException('invalid anchor id');

    const plantedCandidates = await (prisma as any).plantedTree.findMany({
      where: { worldId: safeId, anchorId: aid },
      include: { treeCatalog: true, growthEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!plantedCandidates || plantedCandidates.length === 0) return { ok: false, error: 'tree not found' };

    let planted = plantedCandidates.find((p: any) => (p.growthEvents || []).length > 0) || plantedCandidates[0];

    const treeCatalog = planted.treeCatalog;
    const stagesObj: any = treeCatalog?.stages || {};

    const grouped: Record<string, any> = {};
    for (const ev of planted.growthEvents || []) {
      const s = String(ev.stage || '0');
      if (!grouped[s]) grouped[s] = { stage: ev.stage, requiredEvents: (stagesObj && stagesObj[String(ev.stage)] && stagesObj[String(ev.stage)].requiredEvents) || 0, collectedEvents: 0, percent: 0, events: [] };
      grouped[s].events.push({ id: ev.id, treeId: ev.plantedTreeId, worldId: planted.worldId, anchorId: planted.anchorId, stage: ev.stage, progressIndex: ev.progressIndex, title: ev.title, description: ev.description, createdAt: ev.createdAt });
      grouped[s].collectedEvents = grouped[s].events.length;
      grouped[s].percent = grouped[s].requiredEvents ? (grouped[s].collectedEvents / grouped[s].requiredEvents) * 100 : 0;
    }

    const actual = planted.actualStage;
    const currentStageInfo = (() => {
      const req = (stagesObj && stagesObj[String(actual)] && stagesObj[String(actual)].requiredEvents) || 0;
      const collected = (grouped[String(actual)] && grouped[String(actual)].collectedEvents) || 0;
      return { stage: actual, collectedEvents: collected, requiredEvents: req, percent: req ? (collected / req) * 100 : 0 };
    })();

    for (const k of Object.keys(grouped)) {
      if (!grouped[k].requiredEvents) grouped[k].requiredEvents = (stagesObj && stagesObj[k] && stagesObj[k].requiredEvents) || 0;
    }

    return {
      tree: {
        id: planted.id,
        worldId: planted.worldId,
        anchorId: planted.anchorId,
        treeCatalog: { id: treeCatalog.id, family: treeCatalog.family, stages: treeCatalog.stages, createdAt: treeCatalog.createdAt },
        actualStage: planted.actualStage,
        currentStageSummary: currentStageInfo,
        growthEvents: grouped,
      },
    };
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
    @Body() body: { treeCatalogId?: string; family?: string; title?: string; description?: string; anchorId?: string },
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const { treeCatalogId, family, title, description, anchorId } = body || {};
    if (!treeCatalogId && !family) throw new BadRequestException('provide treeCatalogId or family in body');

    const saved = await this.configService.getByWorldId(safeId);
    if (!saved || !saved.anchors) throw new BadRequestException('world anchors config not found. regenerate anchors first');

    let anchorsArr: any[] = [];
    const a = saved.anchors;
    if (Array.isArray(a)) anchorsArr = a;
    else if (a && typeof a === 'object') {
      if (Array.isArray(a.anchors)) anchorsArr = a.anchors;
      else {
        const keys = Object.keys(a || {}).filter((k) => /^\d+$/.test(k)).sort((x, y) => Number(x) - Number(y));
        if (keys.length > 0) anchorsArr = keys.map((k) => a[k]);
      }
    }

    if (!anchorsArr.length) throw new BadRequestException('no anchors found in world config');

    let chosenAnchorId: string | null = null;
    if (anchorId && String(anchorId).trim()) {
      const aid = String(anchorId).trim();
      const found = anchorsArr.find((x) => String(x.anchorId || x.id || x.slot || '') === aid);
      if (!found) throw new BadRequestException('anchorId not found in world config');
      chosenAnchorId = aid;
    } else {
      for (const anchor of anchorsArr) {
        const aid = anchor && (anchor.anchorId || anchor.id || anchor.slot || '') ? String(anchor.anchorId || anchor.id || anchor.slot) : '';
        if (!aid) continue;
        const exists = await (prisma as any).plantedTree.findFirst({ where: { worldId: safeId, anchorId: aid } });
        if (!exists) {
          chosenAnchorId = aid;
          break;
        }
      }
    }

    if (!chosenAnchorId) throw new BadRequestException('no free anchors available in this world');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      let catalog: any = null;
      if (treeCatalogId) catalog = await tx.treeCatalog.findUnique({ where: { id: treeCatalogId } });
      else if (family) catalog = await tx.treeCatalog.findUnique({ where: { family } });
      if (!catalog) throw new BadRequestException('treeCatalog not found (provide treeCatalogId or family)');

      const aid = chosenAnchorId as string;

      const planted = await tx.plantedTree.create({ data: { worldId: safeId, anchorId: aid, treeCatalogId: catalog.id, actualStage: 1 } });
      const wasNewPlanted = true;

      const targetStage = 1;

      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;

      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: title || '', description: description || '' } });

      return { created, plantedId: planted.id, anchorId: aid };
    });

    // fetch planted full record for payload and emit after commit
    try {
      const plantedFull = await (prisma as any).plantedTree.findUnique({ where: { id: out.plantedId }, include: { treeCatalog: true } });
      if (plantedFull) {
        this.gateway.emitTreePlanted(safeId, plantedFull);
      }
      if (out.created) {
        this.gateway.emitTreeProgress(safeId, out.plantedId, out.created.stage, undefined, null);
      }
    } catch (e) {
      // emit failures shouldn't block response
    }

    return this.getTreeProgression(id, out.anchorId);
  }

  @Post(':id/planted-trees/progress')
  async progressPlantedTreeByBody(
    @Param('id') id: string,
    @Body() body: { plantedTreeId?: string; title?: string; description?: string },
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const providedPlantedId = String(body?.plantedTreeId || '').trim();
      if (!providedPlantedId) throw new BadRequestException('invalid plantedTree id in body');

      const planted = await tx.plantedTree.findUnique({ where: { id: providedPlantedId } });
      if (!planted) throw new BadRequestException('planted tree not found');
      if (planted.worldId !== safeId) throw new BadRequestException('planted tree does not belong to this world');

      // Buscar todos os growthEvents desse plantedTree
      const events = await tx.growthEvent.findMany({
        where: { plantedTreeId: planted.id },
        orderBy: { createdAt: 'asc' }
      });

      let targetStage: number;
      let progressIndex: number;

      if (!events || events.length === 0) {
        targetStage = planted.actualStage || 1;
        progressIndex = 1;
      } else {
        const lastEvent = events[events.length - 1];
        targetStage = lastEvent.stage;
        progressIndex = lastEvent.progressIndex + 1;
      }

      // Buscar o catalog e requiredEvents para esse stage
      const catalog = await tx.treeCatalog.findUnique({ where: { id: planted.treeCatalogId } });
      let required = 1;
      try {
        const stagesObj = catalog?.stages || {};
        required = stagesObj[String(targetStage)]?.requiredEvents || 1;
      } catch {
        required = 1;
      }

      // Se já atingiu o requiredEvents, sobe de stage e reseta progressIndex
      if (progressIndex > required) {
        targetStage += 1;
        progressIndex = 1;
        await tx.plantedTree.update({ where: { id: planted.id }, data: { actualStage: targetStage } });
      }

      // Não permitir criar estágio maior que o disponível no catálogo (número de imagens)
      try {
        const stagesObjAll = catalog?.stages || {};
        const stageKeys = Object.keys(stagesObjAll).map((k) => Number(k)).filter((n) => !Number.isNaN(n));
        if (stageKeys.length > 0) {
          const maxAllowed = Math.max(...stageKeys);
          if (targetStage > maxAllowed) throw new BadRequestException(`cannot create stage ${targetStage}: max stage is ${maxAllowed}`);
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        // ignore other errors and proceed (fallback)
      }

      const created = await tx.growthEvent.create({
        data: {
          plantedTreeId: planted.id,
          stage: targetStage,
          progressIndex,
          title: body?.title ?? '',
          description: body?.description ?? ''
        }
      });

      return { created };
    });

    // after commit emit progress to room
    try {
      const created = out.created;
      // fetch planted to ensure worldId and other info if needed
      const planted = await (prisma as any).plantedTree.findUnique({ where: { id: String(created.plantedTreeId) } });
      const world = planted?.worldId || safeId;
      this.gateway.emitTreeProgress(world, String(created.plantedTreeId), created.stage, undefined, null);
    } catch (e) {
      // ignore emit errors
    }

    return { ok: true, result: out };
  }

}

export default WorldsEventsController;
