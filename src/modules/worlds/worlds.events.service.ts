import { inferTypeFromPath } from './infer-type-from-path.util';
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { WorldsConfigService } from './worlds-config.service';
import { TreesImportService } from './trees-import.service';
import { WorldsGateway } from './worlds.gateway';
import { CommunicationService } from '../shared/communication.service';

@Injectable()
export class WorldsEventsService {
  private readonly logger = new Logger(WorldsEventsService.name);

  constructor(
    private readonly configService: WorldsConfigService,
    private readonly importService: TreesImportService,
    private readonly gateway: WorldsGateway,
    private readonly communicationService: CommunicationService,
  ) {}


  /**
   * Cria evento de crescimento e planta árvore individualmente para o usuário.
   * Agora exige userId e só planta em anchors livres para o usuário.
   */
  async createGrowthEventByCatalog(
    worldId: string,
    body: { userId: string; treeCatalogId?: string; family?: string; title?: string; description?: string; anchorId?: string },
  ) {
    const safeId = String(worldId || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const { userId, treeCatalogId, family, title, description, anchorId } = body || {};
    if (!userId || typeof userId !== 'string' || userId.length < 10) throw new BadRequestException('userId obrigatório e inválido');
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
      // Verifica se já existe árvore do usuário nesse anchor
      const exists = await (prisma as any).plantedTree.findFirst({ where: { worldId: safeId, anchorId: aid, goal: { some: { userId } } } });
      if (exists) throw new BadRequestException('anchorId já ocupado por este usuário');
      chosenAnchorId = aid;
    } else {
      for (const anchor of anchorsArr) {
        const aid = anchor && (anchor.anchorId || anchor.id || anchor.slot || '') ? String(anchor.anchorId || anchor.id || anchor.slot) : '';
        if (!aid) continue;
        // Só considera anchors livres para o usuário
        const exists = await (prisma as any).plantedTree.findFirst({ where: { worldId: safeId, anchorId: aid, goal: { some: { userId } } } });
        if (!exists) {
          chosenAnchorId = aid;
          break;
        }
      }
    }
    if (!chosenAnchorId) throw new BadRequestException('no free anchors available for this user in this world');

    // prepare title/description using IA if missing
    let metaTitle = title || '';
    let metaDesc = description || '';
    if ((!metaTitle || !metaDesc) && userId) {
      const md = await this.communicationService.generateProgressMetadata(userId, { goalTitle: title || '' });
      metaTitle = metaTitle || md.title;
      metaDesc = metaDesc || md.description;
    }

    const out = await (prisma as any).$transaction(async (tx: any) => {
      let catalog: any = null;
      if (treeCatalogId) catalog = await tx.treeCatalog.findUnique({ where: { id: treeCatalogId } });
      else if (family) {
        // Inferir o type a partir do contexto/pasta (exemplo: pode vir de body.path ou outro campo)
        let type = 'continua';
        if ('path' in body && typeof (body as any).path === 'string') {
          type = inferTypeFromPath((body as any).path);
        }
        catalog = await tx.treeCatalog.findFirst({ where: { family, type } });
      }
      if (!catalog) throw new BadRequestException('treeCatalog not found (provide treeCatalogId or family)');

      const aid = chosenAnchorId as string;

      // Cria árvore
      const planted = await tx.plantedTree.create({ data: { worldId: safeId, anchorId: aid, treeCatalogId: catalog.id, actualStage: 1 } });

      // Cria Goal associada à árvore
      await tx.goal.create({
        data: {
          userId,
          title: title || '',
          description: description || '',
          goalKind: 'Continua',
          conquestType: catalog.family,
          plantedTreeId: planted.id,
        },
      });

      // Cria growthEvent inicial
      const targetStage = 1;
      const existingCount = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCount + 1;
      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: metaTitle || '', description: metaDesc || '' } });

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

    // Retorna o progresso da árvore recém-plantada
    // (pode ser ajustado conforme necessidade)
    return { ok: true, plantedId: out.plantedId, anchorId: out.anchorId };
  }

  async progressPlantedTree(
    worldId: string,
    body: { plantedTreeId?: string; goalId?: string; title?: string; description?: string; userId?: string; userMessage?: string },
  ) {
    const safeId = String(worldId || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const { plantedTreeId, goalId, title, description, userId, userMessage } = body || {};

    if (!plantedTreeId && !goalId) throw new BadRequestException('plantedTreeId or goalId required');

    // Resolve plantedTreeId from goalId if necessary
    let resolvedPlantedId = plantedTreeId as string | undefined;
    if (!resolvedPlantedId && goalId) {
      const g = await (prisma as any).goal.findUnique({ where: { id: goalId } });
      if (!g || !g.plantedTreeId) throw new BadRequestException('goal not found or not linked to a plantedTree');
      resolvedPlantedId = g.plantedTreeId;
    }

    if (!resolvedPlantedId) throw new BadRequestException('plantedTreeId could not be resolved');

    if (!userMessage && goalId) {
      this.logger.warn(`progressPlantedTree: userMessage ausente para goalId=${goalId} — usando fallback`);
    }

    // prepare title/description: prefer userMessage como descrição; título criativo via IA
    let metaTitle = title || '';
    let metaDesc = description || '';
    const needsMetadata = (!metaDesc || !metaTitle) && !!userId;
    if (needsMetadata && userId) {
      let goalTitle = '';
      if (goalId) {
        const g = await prisma.goal.findUnique({ where: { id: goalId }, select: { title: true } });
        if (g?.title) goalTitle = g.title;
      }
      const md = await this.communicationService.generateProgressMetadata(userId, { goalTitle, userMessage });
      metaTitle = metaTitle || md.title;
      metaDesc = metaDesc || md.description;
    }

    // Transaction: decide stage and create event atomically
    const out = await (prisma as any).$transaction(async (tx: any) => {
      const planted = await tx.plantedTree.findUnique({ where: { id: resolvedPlantedId }, include: { treeCatalog: true } });
      if (!planted) throw new BadRequestException('planted tree not found');

      const treeCatalog = planted.treeCatalog;
      const stagesObj: any = treeCatalog?.stages || {};
      const currentStage = Number(planted.actualStage || 1);

      // Decide avanço com base em requiredEvents do estágio alvo
      let targetStage = currentStage + 1;

      const stageKeys = Object.keys(stagesObj || {}).map((k) => Number(k)).filter((n) => !Number.isNaN(n));
      const maxStage = stageKeys.length ? Math.max(...stageKeys) : currentStage;

      if (targetStage > maxStage) {
        // se não há próximo stage, mantemos o stage máximo e não avançamos
        targetStage = maxStage;
      }

      // conta eventos já existentes no estágio alvo para definir progressIndex desse estágio
      const existingCountForTarget = await tx.growthEvent.count({ where: { plantedTreeId: planted.id, stage: targetStage } });
      const progressIndex = existingCountForTarget + 1;

      // determina requiredEvents para o estágio alvo (default 1)
      const requiredForTarget = (stagesObj && stagesObj[String(targetStage)] && (stagesObj[String(targetStage)].requiredEvents || stagesObj[String(targetStage)].requiredEvents === 0 ? stagesObj[String(targetStage)].requiredEvents : undefined)) ?? undefined;
      const requiredEvents = typeof requiredForTarget === 'number' ? requiredForTarget : 1;

      // só avançamos se o número de eventos depois de criar este atingir ou exceder requiredEvents
      const willAdvance = targetStage > currentStage && (existingCountForTarget + 1) >= requiredEvents;
      if (willAdvance) {
        await tx.plantedTree.update({ where: { id: planted.id }, data: { actualStage: targetStage } });
      }

      const safeDesc = (metaDesc || description || '').trim()
        || `Registrado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const created = await tx.growthEvent.create({ data: { plantedTreeId: planted.id, stage: targetStage, progressIndex, title: metaTitle || title || '', description: safeDesc } });

      return { created, plantedId: planted.id, eventStage: targetStage, progressIndex };
    });

    // Emit events (best-effort)
    try {
      this.gateway.emitTreeProgress(safeId, out.plantedId, out.eventStage, out.progressIndex, null);
    } catch (e) {
      // ignore emit errors
    }

    return { ok: true, plantedId: out.plantedId, growthEvent: out.created, stage: out.eventStage, progressIndex: out.progressIndex };
  }

  async getTreeProgression(worldId: string, anchorId: string) {
    const safeId = String(worldId || '').replace(/[^a-zA-Z0-9-_]/g, '');
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
}
