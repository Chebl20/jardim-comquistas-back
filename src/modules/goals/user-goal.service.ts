import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';
import { WorldsGateway } from '../worlds/worlds.gateway';
import { inferTypeFromPath } from '../worlds/infer-type-from-path.util';
import { normalizeConquestType, CONQUEST_TYPES } from '../ia/conquest-type.enum';
import { normalizeGoalType } from '../ia/goal-type.util';

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
    frequency?: number | string;
    reminderTime?: Date | string;
    worldId: string;
  }) {
    // 1. Normalizar e validar conquestType recebido (garante consistência vindo de qualquer caminho)
    const normalizedConquest = normalizeConquestType(data.conquestType);
    if (!normalizedConquest) {
      throw new BadRequestException(`conquestType inválido: '${data.conquestType}'. Opções válidas: ${CONQUEST_TYPES.join(', ')}`);
    }
    // 1b. Mapear conquestType para family conforme regra de pontual/contínua
    // Para pontuais: Espiritual → a, Corpo → b, Saúde → c, Água → d
    // Para contínuas: Corpo, Espiritual, Saúde, Água → 'a'; demais → 'b'
    const conquest = String(normalizedConquest).toLowerCase();
    let family = 'b';
    if (data.goalType && data.goalType.toLowerCase() === 'pontual') {
      // Novo mapeamento por switch (pontual)
      switch (true) {
        case conquest.includes('corpo'):
          family = 'a';
          break;
        case conquest.includes('espiritual'):
          family = 'b';
          break;
        case conquest.includes('financeiro') || conquest.includes('financeiro'):
          family = 'c';
          break;
        case conquest.includes('hobby') || conquest.includes('lazer'):
          family = 'd';
          break;
        default:
          // mantém comportamento padrão para casos não mapeados
          family = 'b';
      }
    } else {
      const familyA = ['Corpo', 'Espiritual', 'Saúde', 'Água'];
      if (familyA.some((t) => conquest.includes(t.toLowerCase()))) {
        family = 'a';
      }
    }
    // Inferir o type a partir do contexto/pasta (exemplo: pode vir de data.path ou outro campo)
    // Aqui, como exemplo, se não houver path, assume 'continua' (mantém compatibilidade)
    // Se data tiver path, infere o type; senão, mantém 'continua'
    // Determina o type a partir do goalType (normalizado em runtime)
    let type = 'continua';
    const ng = normalizeGoalType(data.goalType as any);
    if (ng === 'Pontual') type = 'pontual';
    else if (ng === 'Continua') type = 'continua';
    else if ('path' in data && typeof (data as any).path === 'string') {
      type = inferTypeFromPath((data as any).path);
    }
    const treeCatalog = await prisma.treeCatalog.findFirst({ where: { family, type } });
    if (!treeCatalog) throw new BadRequestException(`Tipo de árvore (family='${family}', type='${type}') não encontrado no catálogo para conquestType '${data.conquestType}'`);

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
    const isPontual = type === 'pontual';
    let chosenAnchorId: string | null = null;
    for (const anchor of anchorsArr) {
      const aid = anchor && (anchor.anchorId || anchor.id || anchor.slot || '') ? String(anchor.anchorId || anchor.id || anchor.slot) : '';
      if (!aid) continue;
      const at = (anchor && (anchor.treeType || anchor.type || anchor.dataType)) ? String(anchor.treeType || anchor.type || anchor.dataType).toLowerCase() : '';
      // Se é pontual, só aceitar anchors que tenham treeType === 'sky'
      if (isPontual) {
        if (at !== 'sky') continue;
      } else {
        // Para metas contínuas, não aceitar anchors do tipo 'sky'
        if (at === 'sky') continue;
      }
      // Agora filtra só pelas árvores do usuário no mundo
      const exists = await prisma.plantedTree.findFirst({ where: { worldId: data.worldId, anchorId: aid, userGoals: { some: { userId: data.userId } } } });
      if (!exists) {
        chosenAnchorId = aid;
        break;
      }
    }
    if (!chosenAnchorId) {
      if (isPontual) throw new BadRequestException('Não há anchors livres do tipo "sky" disponíveis para este usuário neste mundo');
      throw new BadRequestException('Não há anchors livres disponíveis para este usuário neste mundo');
    }

    // 3. Preparar validações finais e normalizações antes de criar
    // Validação de userId
    if (!data.userId || typeof data.userId !== 'string' || data.userId.length < 10) {
      throw new Error('userId inválido ao criar meta: ' + String(data.userId));
    }

    // Validação/normalização de reminderTime
    let reminderTime: Date | undefined = undefined;
    if (data.reminderTime) {
      try {
        // Determinar timezone do usuário (fallback Brasília)
        let tz = 'America/Sao_Paulo';
        try {
          const u = await prisma.user.findUnique({ where: { id: data.userId }, select: { timezone: true } });
          if (u && (u as any).timezone) tz = (u as any).timezone;
        } catch (e) {
          // ignore
        }

        // Se for string, tentar tratar time-only (ex: "08:30")
        if (typeof data.reminderTime === 'string') {
          const s = data.reminderTime.trim();
          const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (timeOnly) {
            const hh = parseInt(timeOnly[1], 10);
            const mm = parseInt(timeOnly[2], 10);
            let dt = DateTime.now().setZone(tz).set({ hour: hh, minute: mm, second: Number(timeOnly[3] || 0), millisecond: 0 });
            // se já passou hoje, agendar para amanhã
            if (dt <= DateTime.now().setZone(tz)) dt = dt.plus({ days: 1 });
            reminderTime = dt.toUTC().toJSDate();
          } else {
            // tentar parse ISO com timezone do usuário
            let dt = DateTime.fromISO(s, { zone: tz });
            if (!dt.isValid) {
              // tentar parse como number timestamp
              const n = Number(s);
              if (!isNaN(n)) dt = DateTime.fromMillis(n, { zone: tz });
            }
            if (dt.isValid) reminderTime = dt.toUTC().toJSDate();
            else {
              // fallback para Date constructor
              const d = new Date(s as any);
              if (!isNaN(d.getTime())) reminderTime = d;
              else console.warn('[UserGoal] reminderTime inválido (string):', data.reminderTime);
            }
          }
        } else if (data.reminderTime instanceof Date) {
          const d: Date = data.reminderTime as Date;
          const dt = DateTime.fromJSDate(d).setZone(tz);
          // se o ano da data fornecida for muito antigo/fora do esperado, tratar como time-only
          const nowYear = DateTime.now().setZone(tz).year;
          if (dt.year < nowYear - 1) {
            // usar horas/minutos e combinar com hoje
            let combined = DateTime.now().setZone(tz).set({ hour: dt.hour, minute: dt.minute, second: dt.second, millisecond: 0 });
            if (combined <= DateTime.now().setZone(tz)) combined = combined.plus({ days: 1 });
            reminderTime = combined.toUTC().toJSDate();
          } else {
            reminderTime = dt.toUTC().toJSDate();
          }
        } else {
          // tentar conversão genérica
          const d = new Date(data.reminderTime as any);
          if (!isNaN(d.getTime())) reminderTime = d;
          else console.warn('[UserGoal] reminderTime inválido (tipo desconhecido):', data.reminderTime);
        }
      } catch (e) {
        console.warn('[UserGoal] Erro ao normalizar reminderTime:', e, data.reminderTime);
      }
    }

    // Coerce frequency: expected Int? in Prisma. If incoming value is string non-numérico, ignore (store null).
    let frequencyInt: number | undefined = undefined;
    if (typeof data.frequency === 'number') {
      frequencyInt = data.frequency as number;
    } else if (typeof data.frequency === 'string') {
      const n = parseInt(data.frequency.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(n)) frequencyInt = n;
      else frequencyInt = undefined;
    }

    // 4. Criar a árvore (PlantedTree), growthEvent inicial e UserGoal em transação
    const txResult = await prisma.$transaction(async (tx) => {
      const planted = await tx.plantedTree.create({
        data: {
          worldId: data.worldId,
          anchorId: chosenAnchorId,
          treeCatalogId: treeCatalog.id,
          actualStage: 1,
        },
      });
      // Cria growthEvent inicial
      await tx.growthEvent.create({
        data: {
          plantedTreeId: planted.id,
          stage: 1,
          progressIndex: 1,
          title: data.title || '',
          description: data.description || '',
        },
      });

      // Criar a meta (UserGoal) associada à árvore dentro da mesma transação
      const ug = await tx.userGoal.create({
        data: {
          userId: data.userId,
          title: data.title,
          description: data.description,
          goalType: data.goalType,
          conquestType: data.conquestType,
          frequency: frequencyInt,
          reminderTime,
          plantedTreeId: planted.id,
          anchorId: chosenAnchorId,
        },
      });

      return { planted, userGoal: ug };
    });

    const plantedTreeFull = await prisma.plantedTree.findUnique({ where: { id: txResult.planted.id }, include: { treeCatalog: true } });

    // Emitir evento socket para frontend atualizar quadro
    this.worldsGateway.emitTreePlanted(data.worldId, plantedTreeFull);
    // Emitir também o progresso inicial
    this.worldsGateway.emitTreeProgress(data.worldId, txResult.planted.id, 1, undefined, data.userId);

    return txResult.userGoal;
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
        completed: false,
        reminderTime: { not: null },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        goalType: true,
        conquestType: true,
        reminderTime: true,
        lastReminderSentAt: true,
        dailyStatus: true,
        silenceUntil: true,
        completed: true,
      },
    });
  }
}
