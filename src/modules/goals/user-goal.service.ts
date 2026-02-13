import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { WorldsGateway } from '../worlds/worlds.gateway';

@Injectable()
export class UserGoalService {
  private readonly logger = new Logger(UserGoalService.name);

  constructor(private readonly worldsGateway: WorldsGateway) {}

  /**
   * Cria uma meta de usuário (UserGoal) e planta a árvore correspondente (PlantedTree).
   * @param data Dados da meta vindos da IA
   * @returns UserGoal criado (com relação à árvore)
   */
  async createUserGoalWithTree(data: {
    userId: string;
    title: string;
    description?: string;
    goalType: string;
    conquestType: string;
    frequency?: number;
    reminderTime?: Date;
    worldId: string;
  }) {
    // 1. Mapear conquestType para family 'a' ou 'b'
    // Exemplo: Corpo, Espiritual, Saúde, Água → 'a'; Mente, Trabalho, Social, etc → 'b'
    const familyA = ['Corpo', 'Espiritual', 'Saúde', 'Água'];
    const conquest = (data.conquestType || '').toLowerCase();
    let family = 'b';
    if (familyA.some((t) => conquest.includes(t.toLowerCase()))) {
      family = 'a';
    }
    // Buscar o TreeCatalog pelo family
    const treeCatalog = await prisma.treeCatalog.findUnique({ where: { family } });
    if (!treeCatalog) throw new BadRequestException(`Tipo de árvore (family='${family}') não encontrado no catálogo para conquestType '${data.conquestType}'`);

    // 2. Buscar um anchorId livre no worldId
    const worldConfig = await prisma.worldConfig.findUnique({ where: { worldId: data.worldId } });
    if (!worldConfig) {
      throw new BadRequestException('Configuração de anchors não encontrada para o mundo: worldConfig ausente. Use POST /api/worlds/:id/anchors-config/regenerate');
    }
    if (!worldConfig.anchors || (Array.isArray(worldConfig.anchors) && worldConfig.anchors.length === 0)) {
      throw new BadRequestException('Configuração de anchors presente mas vazia. Execute POST /api/worlds/:id/anchors-config/regenerate para gerar anchors a partir do SVG');
    }
    let anchorsArr: any[] = [];
    if (Array.isArray(worldConfig.anchors)) {
      anchorsArr = worldConfig.anchors;
    } else if (worldConfig.anchors && typeof worldConfig.anchors === 'object' && 'anchors' in worldConfig.anchors && Array.isArray((worldConfig.anchors as any).anchors)) {
      anchorsArr = (worldConfig.anchors as any).anchors;
    }
    let chosenAnchorId: string | null = null;
    for (const anchor of anchorsArr) {
      const aid = anchor && (anchor.anchorId || anchor.id || anchor.slot || '') ? String(anchor.anchorId || anchor.id || anchor.slot) : '';
      if (!aid) continue;
      // Agora filtra só pelas árvores do usuário no mundo
      const exists = await prisma.plantedTree.findFirst({ where: { worldId: data.worldId, anchorId: aid, userGoals: { some: { userId: data.userId } } } });
      if (!exists) {
        chosenAnchorId = aid;
        break;
      }
    }
    if (!chosenAnchorId) throw new BadRequestException('Não há anchors livres disponíveis para este usuário neste mundo');

    // 3. Criar a árvore (PlantedTree) e growthEvent inicial em transação
    const plantedTree = await prisma.$transaction(async (tx) => {
      const planted = await tx.plantedTree.create({
        data: {
          worldId: data.worldId,
          anchorId: chosenAnchorId,
          treeCatalogId: treeCatalog.id,
          actualStage: 1,
        },
      });
      // Cria growthEvent inicial igual ao WorldsEventsService
      await tx.growthEvent.create({
        data: {
          plantedTreeId: planted.id,
          stage: 1,
          progressIndex: 1,
          title: data.title || '',
          description: data.description || '',
        },
      });
      return planted;
    });

    // Buscar o plantedTree completo (com treeCatalog)
    const plantedTreeFull = await prisma.plantedTree.findUnique({
      where: { id: plantedTree.id },
      include: { treeCatalog: true },
    });

    // Emitir evento socket para frontend atualizar quadro (payload igual WorldsEventsService)
    this.worldsGateway.emitTreePlanted(data.worldId, plantedTreeFull);

    // Emitir também o progresso inicial (opcional, igual WorldsEventsService)
    this.worldsGateway.emitTreeProgress(data.worldId, plantedTree.id, 1, undefined, data.userId);

    // 4. Criar a meta (UserGoal) associada à árvore
    // Validação de userId
    if (!data.userId || typeof data.userId !== 'string' || data.userId.length < 10) {
      throw new Error('userId inválido ao criar meta: ' + String(data.userId));
    }

    // Validação de reminderTime
    let reminderTime: Date | undefined = undefined;
    if (data.reminderTime) {
      const d = new Date(data.reminderTime);
      if (!isNaN(d.getTime())) {
        reminderTime = d;
      } else {
        console.warn('[UserGoal] reminderTime inválido:', data.reminderTime);
      }
    }

    this.logger.debug(`Criando meta para userId: ${data.userId}`);
    const userGoal = await prisma.userGoal.create({
      data: {
        userId: data.userId,
        title: data.title,
        description: data.description,
        goalType: data.goalType,
        conquestType: data.conquestType,
        frequency: data.frequency,
        reminderTime,
        plantedTreeId: plantedTree.id,
        anchorId: chosenAnchorId,
      },
    });

    return userGoal;
  }

  /**
   * Marca uma meta como concluída
   */
  async completeGoal(goalId: string) {
    return prisma.userGoal.update({ where: { id: goalId }, data: { completed: true } });
  }

  /**
   * Busca metas ativas para lembretes
   */
  async getActiveGoalsForReminders() {
    return prisma.userGoal.findMany({
      where: {
        goalType: 'Contínua',
        completed: false,
        reminderTime: { not: null },
      },
    });
  }
}
