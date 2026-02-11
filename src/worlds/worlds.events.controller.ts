import { Controller, Get, Post, Delete, Param, Body, BadRequestException, Query } from '@nestjs/common';
import { prisma } from '../prisma/client';
import { WorldsConfigService } from './worlds-config.service';
import { TreesImportService } from './trees-import.service';

@Controller('api/worlds')
export class WorldsEventsController {
  constructor(private readonly configService: WorldsConfigService, private readonly importService: TreesImportService) {}

  @Get(':id/trees/:anchorId/progression')
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

  @Post(':id/trees/:anchorId/events')
  async createGrowthEvent(
    @Param('id') id: string,
    @Param('anchorId') anchorId: string,
    @Body() body: { treeCatalogId?: string; family?: string; title?: string; description?: string },
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const aid = String(anchorId || '').trim();
    if (!aid) throw new BadRequestException('invalid anchor id');

    const { treeCatalogId, family, title, description } = body || {};

    const out = await (prisma as any).$transaction(async (tx: any) => {
      let catalog: any = null;
      if (treeCatalogId) catalog = await tx.treeCatalog.findUnique({ where: { id: treeCatalogId } });
      else if (family) catalog = await tx.treeCatalog.findUnique({ where: { family } });
      if (!catalog) throw new BadRequestException('treeCatalog not found (provide treeCatalogId or family)');

      let planted = await tx.plantedTree.findFirst({ where: { worldId: safeId, anchorId: aid } });
      let wasNewPlanted = false;
      if (!planted) {
        planted = await tx.plantedTree.create({ data: { worldId: safeId, anchorId: aid, treeCatalogId: catalog.id, actualStage: 1 } });
        wasNewPlanted = true;
      }

      const targetStage = planted.actualStage || 1;

      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;

      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: title || '', description: description || '' } });

      let required = 1;
      try {
        const stagesObj = catalog.stages || {};
        required = (stagesObj && stagesObj[String(targetStage)] && stagesObj[String(targetStage)].requiredEvents) || 1;
      } catch {
        required = 1;
      }

      if (!wasNewPlanted && progressIndex >= required) {
        await tx.plantedTree.update({ where: { id: planted.id }, data: { actualStage: targetStage + 1 } });
      }

      return created;
    });

    return this.getTreeProgression(id, anchorId);
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

    return this.getTreeProgression(id, out.anchorId);
  }

  @Get(':id/trees/events')
  async listGrowthEvents(@Param('id') id: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const planted = await (prisma as any).plantedTree.findMany({
      where: { worldId: safeId },
      include: { treeCatalog: true, growthEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    const out = planted.map((p: any) => ({
      id: p.id,
      worldId: p.worldId,
      anchorId: p.anchorId,
      treeCatalog: p.treeCatalog ? { id: p.treeCatalog.id, family: p.treeCatalog.family } : undefined,
      actualStage: p.actualStage,
      events: (p.growthEvents || []).map((e: any) => ({ id: e.id, createdAt: e.createdAt, stage: e.stage, progressIndex: e.progressIndex, title: e.title, description: e.description })),
    }));

    return { events: out };
  }

  @Post(':id/trees/:anchorId/events/new')
  async createNewPlantedTreeWithEvent(
    @Param('id') id: string,
    @Param('anchorId') anchorId: string,
    @Body() body: { treeCatalogId?: string; family?: string; title?: string; description?: string },
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const aid = String(anchorId || '').trim();
    if (!aid) throw new BadRequestException('invalid anchor id');

    const { treeCatalogId, family, title, description } = body || {};
    if (!treeCatalogId && !family) throw new BadRequestException('provide treeCatalogId or family in body');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      let catalog: any = null;
      if (treeCatalogId) catalog = await tx.treeCatalog.findUnique({ where: { id: treeCatalogId } });
      else if (family) catalog = await tx.treeCatalog.findUnique({ where: { family } });
      if (!catalog) throw new BadRequestException('treeCatalog not found');

      const planted = await tx.plantedTree.create({ data: { worldId: safeId, anchorId: aid, treeCatalogId: catalog.id, actualStage: 1 } });

      const targetStage = 1;
      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;

      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: title || '', description: description || '' } });

      return { created, plantedId: planted.id, anchorId: aid };
    });

    return this.getTreeProgression(id, out.anchorId);
  }

  @Post(':id/events/:eventId/progress')
  async progressEventById(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() body: { title?: string; description?: string },
  ) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const eid = String(eventId || '').trim();
    if (!eid) throw new BadRequestException('invalid event id');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const ev = await tx.growthEvent.findUnique({ where: { id: eid }, include: { plantedTree: true } });
      if (!ev) throw new BadRequestException('event not found');
      const planted = ev.plantedTree;
      if (!planted) throw new BadRequestException('planted tree not found for event');
      if (planted.worldId !== safeId) throw new BadRequestException('event does not belong to this world');

      const targetStage = ev.stage;

      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;

      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: body?.title ?? ev.title ?? '', description: body?.description ?? ev.description ?? '' } });

      const catalog = await tx.treeCatalog.findUnique({ where: { id: planted.treeCatalogId } });
      let required = 1;
      try {
        const stagesObj = catalog && catalog.stages ? catalog.stages : {};
        required = (stagesObj && stagesObj[String(targetStage)] && stagesObj[String(targetStage)].requiredEvents) || 1;
      } catch {
        required = 1;
      }

      if (progressIndex >= required) {
        await tx.plantedTree.update({ where: { id: planted.id }, data: { actualStage: targetStage + 1 } });
      }

      return { created };
    });

    return { ok: true, result: out };
  }

  @Post(':id/events/progress')
  async progressEventByBody(@Param('id') id: string, @Body() body: { eventId?: string; title?: string; description?: string }) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const eid = String(body?.eventId || '').trim();
    if (!eid) throw new BadRequestException('invalid event id in body');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const ev = await tx.growthEvent.findUnique({ where: { id: eid }, include: { plantedTree: true } });
      if (!ev) throw new BadRequestException('event not found');
      const planted = ev.plantedTree;
      if (!planted) throw new BadRequestException('planted tree not found for event');
      if (planted.worldId !== safeId) throw new BadRequestException('event does not belong to this world');

      const targetStage = ev.stage;

      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;

      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: body?.title ?? ev.title ?? '', description: body?.description ?? ev.description ?? '' } });

      const catalog = await tx.treeCatalog.findUnique({ where: { id: planted.treeCatalogId } });
      let required = 1;
      try {
        const stagesObj = catalog && catalog.stages ? catalog.stages : {};
        required = (stagesObj && stagesObj[String(targetStage)] && stagesObj[String(targetStage)].requiredEvents) || 1;
      } catch {
        required = 1;
      }

      if (progressIndex >= required) {
        await tx.plantedTree.update({ where: { id: planted.id }, data: { actualStage: targetStage + 1 } });
      }

      return { created };
    });

    return { ok: true, result: out };
  }

  @Delete(':id/events/:eventId')
  async deleteEventById(@Param('id') id: string, @Param('eventId') eventId: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const eid = String(eventId || '').trim();
    if (!eid) throw new BadRequestException('invalid event id');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const ev = await tx.growthEvent.findUnique({ where: { id: eid }, include: { plantedTree: true } });
      if (!ev) throw new BadRequestException('event not found');
      const planted = ev.plantedTree;
      if (!planted) throw new BadRequestException('planted tree not found for event');
      if (planted.worldId !== safeId) throw new BadRequestException('event does not belong to this world');

      await tx.growthEvent.delete({ where: { id: eid } });
      return { ok: true, deletedId: eid };
    });

    return out;
  }

  @Get(':id/events/:eventId')
  async getEventById(@Param('id') id: string, @Param('eventId') eventId: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const eid = String(eventId || '').trim();
    if (!eid) throw new BadRequestException('invalid event id');

    const ev = await (prisma as any).growthEvent.findUnique({ where: { id: eid }, include: { plantedTree: { include: { treeCatalog: true } } } });
    if (!ev) throw new BadRequestException('event not found');
    const planted = ev.plantedTree;
    if (!planted) throw new BadRequestException('planted tree not found for event');
    if (planted.worldId !== safeId) throw new BadRequestException('event does not belong to this world');

    return {
      id: ev.id,
      createdAt: ev.createdAt,
      stage: ev.stage,
      progressIndex: ev.progressIndex,
      title: ev.title,
      description: ev.description,
      plantedTree: planted ? { id: planted.id, worldId: planted.worldId, anchorId: planted.anchorId, actualStage: planted.actualStage, treeCatalog: planted.treeCatalog ? { id: planted.treeCatalog.id, family: planted.treeCatalog.family } : undefined } : undefined,
    };
  }

  @Delete(':id/events')
  async deleteEventByBody(@Param('id') id: string, @Body() body: { eventId?: string }) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    const eid = String(body?.eventId || '').trim();
    if (!eid) throw new BadRequestException('invalid event id in body');

    const out = await (prisma as any).$transaction(async (tx: any) => {
      const ev = await tx.growthEvent.findUnique({ where: { id: eid }, include: { plantedTree: true } });
      if (!ev) throw new BadRequestException('event not found');
      const planted = ev.plantedTree;
      if (!planted) throw new BadRequestException('planted tree not found for event');
      if (planted.worldId !== safeId) throw new BadRequestException('event does not belong to this world');

      await tx.growthEvent.delete({ where: { id: eid } });
      return { ok: true, deletedId: eid };
    });

    return out;
  }
}

export default WorldsEventsController;
