import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';
import { WorldsGateway } from '../worlds/worlds.gateway';
import { inferTypeFromPath } from '../worlds/infer-type-from-path.util';
import { normalizeConquestType, CONQUEST_TYPES } from '../ia/conquest-type.enum';
import { normalizeGoalType } from '../ia/goal-type.util';
import { CommunicationService } from '../shared/communication.service';
import type { CreateUserGoalInput, ScheduleConfig } from '../ia/conversation/flow.types';


@Injectable()
export class UserGoalService {
  createGoal(arg0: any) {
    throw new Error('Method not implemented.');
  }
  private readonly logger = new Logger(UserGoalService.name);

  constructor(
    private readonly worldsGateway: WorldsGateway,
    private readonly communicationService: CommunicationService,
  ) {}

  /**
   * Cria uma meta de usuário (UserGoal) e planta a árvore correspondente (PlantedTree).
   * @param data Dados da meta vindos da IA
   * @returns UserGoal criado (com relação à árvore)
   */
  async createUserGoalWithTree(
    data: Omit<CreateUserGoalInput, 'reminderTime'> & { reminderTime?: Date | string; scheduleConfig?: ScheduleConfig },
  ) {
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
        case conquest.includes('financeiro'):
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
      // Metas contínuas: mapear para a, b, c, d
      switch (true) {
        case conquest.includes('corpo') || conquest.includes('espiritual') || conquest.includes('saud') || conquest.includes('agua'):
          family = 'a';
          break;
        case conquest.includes('financeiro'):
          family = 'c';
          break;
        case conquest.includes('hobby') || conquest.includes('lazer'):
          family = 'd';
          break;
        default:
          // Mente, Familia, Trabalho, Social → 'b'
          family = 'b';
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
    const normalizedGoalType = ng ?? (type === 'pontual' ? 'Pontual' : 'Continua');
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
      const exists = await prisma.plantedTree.findFirst({ where: { worldId: data.worldId, anchorId: aid, goal: { is: { userId: data.userId } } } });
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

    // scheduleConfig: nova fonte de agendamento (prioridade sobre reminderTime)
    let scheduleConfigJson: object | undefined = undefined;
    if (data.scheduleConfig && typeof data.scheduleConfig === 'object') {
      const sc = data.scheduleConfig as ScheduleConfig;
      if (sc.type === 'once' && sc.at) {
        const at = String(sc.at).trim();
        const timeOnly = at.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (timeOnly) {
          let tz = 'America/Sao_Paulo';
          try {
            const u = await prisma.user.findUnique({ where: { id: data.userId }, select: { timezone: true } });
            if (u && (u as any).timezone) tz = (u as any).timezone;
          } catch {
            // ignore
          }
          const hh = parseInt(timeOnly[1], 10);
          const mm = parseInt(timeOnly[2], 10);
          const ss = parseInt(timeOnly[3] || '0', 10);
          const dt = DateTime.now()
            .setZone(tz)
            .set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
          scheduleConfigJson = { ...sc, at: dt.toISO()! };
        } else {
          scheduleConfigJson = sc;
        }
      } else if (sc.type === 'daily' && Array.isArray(sc.times) && sc.times.length > 0) scheduleConfigJson = sc;
      else if (sc.type === 'weekly' && Array.isArray(sc.daysOfWeek) && Array.isArray(sc.times) && sc.times.length > 0)
        scheduleConfigJson = sc;
    }

    // Validação/normalização de reminderTime (usado quando scheduleConfig type=once ou legado)
    let reminderTime: Date | undefined = undefined;
    const scOnce = scheduleConfigJson as ScheduleConfig;
    if (scOnce && scOnce.type === 'once' && 'at' in scOnce) {
      const at = scOnce.at;
      try {
        reminderTime = new Date(at);
        if (Number.isNaN(reminderTime.getTime())) reminderTime = undefined;
      } catch {
        reminderTime = undefined;
      }
    }
    if (!reminderTime && data.reminderTime) {
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
      frequencyInt = data.frequency;
    }

    // before persisting, make sure there is a title/description
    let title = data.title || '';
    let description = data.description || '';
    if ((!title || !description) && data.userId) {
      try {
        const md = await this.communicationService.generateProgressMetadata(data.userId, { goalTitle: title });
        title = title || md.title;
        description = description || md.description;
      } catch (e) {
        // ignore, fallback to whatever we have
      }
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
          title,
          description,
        },
      });

      // Criar a meta (Goal) associada à árvore dentro da mesma transação
      const goal = await tx.goal.create({
        data: {
          userId: data.userId,
          title,
          description,
          conquestType: normalizedConquest,
          goalKind: normalizedGoalType,
          reminderTime,
          scheduleConfig: scheduleConfigJson ?? undefined,
          plantedTreeId: planted.id,
        },
      });

      return { planted, goal };
    });

    const plantedTreeFull = await prisma.plantedTree.findUnique({ where: { id: txResult.planted.id }, include: { treeCatalog: true } });

    // Emitir evento socket para frontend atualizar quadro
    this.worldsGateway.emitTreePlanted(data.worldId, plantedTreeFull);
    // Emitir também o progresso inicial
    this.worldsGateway.emitTreeProgress(data.worldId, txResult.planted.id, 1, undefined, data.userId);

    return txResult.goal;
  }

  /**
   * Marca uma meta como concluída
   */
  async completeGoal(goalId: string) {
    return prisma.goal.update({ where: { id: goalId }, data: { completed: true } });
  }

  async markGoalDoneFromReminder(goalId: string, goalType?: string) {
    const goal = await prisma.goal.findUnique({
      where: { id: goalId },
      select: { goalKind: true },
    });
    const actualType = goal?.goalKind ? normalizeGoalType(goal.goalKind) : normalizeGoalType(goalType as any);
    if (actualType === 'Continua') {
      return prisma.goal.update({
        where: { id: goalId },
        data: {
          dailyStatus: 'DONE',
          silenceUntil: null,
        },
      });
    }

    return prisma.goal.update({
      where: { id: goalId },
      data: {
        completed: true,
        dailyStatus: 'DONE',
        silenceUntil: null,
      },
    });
  }

  async updateReminderState(
    goalId: string,
    data: { dailyStatus?: string | null; silenceUntil?: Date | null },
  ) {
    return prisma.goal.update({
      where: { id: goalId },
      data: {
        ...(data.dailyStatus !== undefined ? { dailyStatus: data.dailyStatus } : {}),
        ...(data.silenceUntil !== undefined ? { silenceUntil: data.silenceUntil } : {}),
      },
    });
  }

  /**
   * Busca metas ativas para lembretes
   */
  async getActiveGoalsForReminders() {
    return prisma.goal.findMany({
      where: {
        completed: false,
        OR: [{ scheduleConfig: { not: Prisma.DbNull } }, { reminderTime: { not: null } }],
      },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        goalKind: true,
        conquestType: true,
        reminderTime: true,
        scheduleConfig: true,
        reminderSlotsToday: true,
        lastReminderSentAt: true,
        dailyStatus: true,
        silenceUntil: true,
        completed: true,
        reminderCount: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            telegramId: true,
            timezone: true,
          },
        },
        plantedTree: {
          select: {
            growthEvents: {
              select: {
                createdAt: true,
                progressIndex: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 2,
            },
          },
        },
      },
    });
  }

  /**
   * Retorna metas por IDs (para mapear pendingGoalIds em otherGoals).
   */
  async getGoalsByIds(goalIds: string[]) {
    if (goalIds.length === 0) return [];
    return prisma.goal.findMany({
      where: { id: { in: goalIds } },
      select: { id: true, title: true },
    });
  }

  /**
   * Retorna metas que já receberam lembrete hoje e o usuário ignorou
   * (não completou, não dispensou).
   * Status considerados: WAITING_OPERATIONAL_REPLY, WAITING_FOLLOW_UP_REPLY,
   * WAITING_REACTIVATION_REPLY, MISSED.
   * Usado para a seção "Além disso, estas metas ainda estão pendentes hoje" em mensagens subsequentes.
   */
  async getIgnoredGoalsForToday(
    userId: string,
    timezone = 'America/Sao_Paulo',
    excludeGoalIds: string[] = [],
  ) {
    const todayGoals = await this.getGoalsForTodayForUser(userId, timezone);
    const now = DateTime.now().setZone(timezone);
    const todayStart = now.startOf('day').toJSDate();
    const todayEnd = now.endOf('day').toJSDate();

    const todayGoalIds = todayGoals.map((g: any) => g.id).filter(
      (id: string) => !excludeGoalIds.includes(id),
    );

    if (todayGoalIds.length === 0) return [];

    const ignored = await prisma.goal.findMany({
      where: {
        userId,
        id: { in: todayGoalIds },
        completed: false,
        lastReminderSentAt: { gte: todayStart, lte: todayEnd },
        dailyStatus: {
          in: [
            'WAITING_OPERATIONAL_REPLY',
            'WAITING_FOLLOW_UP_REPLY',
            'WAITING_REACTIVATION_REPLY',
            'MISSED',
          ],
        },
      },
      select: {
        id: true,
        title: true,
        dailyStatus: true,
      },
    });

    return ignored;
  }

  /**
   * Retorna metas do dia com dailyStatus e completed, excluindo as com silenceUntil > now
   * (ex: usuário disse "não vou conseguir hoje").
   * Usado para montar mensagens de lembrete (outras pendentes, progresso X/Y).
   */
  async getGoalsForTodayWithStatus(userId: string, timezone = 'America/Sao_Paulo') {
    const todayGoals = await this.getGoalsForTodayForUser(userId, timezone);
    const now = DateTime.now().setZone(timezone).toJSDate();

    const goalsWithStatus = await prisma.goal.findMany({
      where: {
        userId,
        id: { in: todayGoals.map((g: any) => g.id) },
        completed: false,
      },
      select: {
        id: true,
        title: true,
        dailyStatus: true,
        silenceUntil: true,
        completed: true,
      },
    });

    return goalsWithStatus.filter((g) => {
      const silenceUntil = g.silenceUntil ? new Date(g.silenceUntil) : null;
      if (silenceUntil && silenceUntil > now) return false;
      return true;
    });
  }

  /**
   * Retorna metas relevantes para uma data específica (no timezone do usuário).
   * @param includeCompleted - quando true, inclui pontuais concluídas (para exibição "metas para hoje")
   */
  async getGoalsForDateForUser(
    userId: string,
    targetDate: DateTime,
    timezone = 'America/Sao_Paulo',
    options?: { includeCompleted?: boolean },
  ) {
    const all = await this.getGoalsForUser(userId);
    const targetDow = targetDate.weekday === 7 ? 0 : targetDate.weekday; // 0=Dom, 1=Seg..6=Sab
    const targetStart = targetDate.startOf('day');

    return all.filter((g: any) => {
      const isPontualCompleted = g.goalKind === 'Pontual' && g.completed === true;
      if (!(options?.includeCompleted ?? false) && isPontualCompleted) return false;

      const sc = g.scheduleConfig as import('../ia/conversation/flow.types').ScheduleConfig | null;
      if (sc && typeof sc === 'object') {
        if (sc.type === 'once') {
          const at = new Date(sc.at);
          const userAt = DateTime.fromJSDate(at).setZone(timezone);
          return userAt.hasSame(targetStart, 'day');
        }
        if (sc.type === 'daily') {
          if (sc.durationDays) {
            const createdAt = DateTime.fromJSDate(new Date(g.createdAt)).setZone(timezone);
            const daysSince = Math.floor(targetDate.diff(createdAt, 'days').days);
            return daysSince < sc.durationDays;
          }
          return true;
        }
        if (sc.type === 'weekly') {
          return sc.daysOfWeek.includes(targetDow);
        }
      }
      // Legado: reminderTime ou frequency
      if (g.reminderTime) return true;
      if (g.frequency && g.frequency >= 1) return true;
      return false;
    });
  }

  /**
   * Retorna metas que têm lembretes agendados para hoje (no timezone do usuário).
   * Usado pelo resumo diário (DailyDigest).
   */
  async getGoalsForTodayForUser(userId: string, timezone = 'America/Sao_Paulo') {
    const now = DateTime.now().setZone(timezone);
    return this.getGoalsForDateForUser(userId, now, timezone, { includeCompleted: false });
  }

  /**
   * Retorna metas que estarão pendentes amanhã (no timezone do usuário).
   * Usado pelo GoalStatus para perguntas "metas para amanhã".
   */
  async getGoalsForTomorrowForUser(userId: string, timezone = 'America/Sao_Paulo') {
    const now = DateTime.now().setZone(timezone);
    const tomorrow = now.plus({ days: 1 });
    return this.getGoalsForDateForUser(userId, tomorrow, timezone, { includeCompleted: false });
  }

  /**
   * Recupera todas as metas do usuário. Útil para fornecer contexto à IA.
   */
  async getGoalsForUser(userId: string) {
    // traz também alguns dados da árvore plantada associada à meta,
    // para que o orquestrador possa expor essas informações ao modelo
    // e ele seja capaz de responder perguntas relacionadas à árvore.
    // Campos selecionados são deliberadamente limitados para não vazar
    // informação desnecessária (por ex. stages completas do catálogo).
    return prisma.goal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        description: true,
        goalKind: true,
        conquestType: true,
        completed: true,
        reminderTime: true,
        scheduleConfig: true,
        createdAt: true,
        plantedTree: {
          select: {
            id: true,
            anchorId: true,
            actualStage: true,
            createdAt: true,
            treeCatalog: {
              select: {
                family: true,
                type: true,
              },
            },
            growthEvents: {
              select: {
                id: true,
                stage: true,
                createdAt: true,
                title: true,
                description: true,
                progressIndex: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 30,
            },
          },
        },
      },
    });
  }
}
