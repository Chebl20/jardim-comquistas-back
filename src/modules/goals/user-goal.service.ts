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
import { luxonWeekdayToJsDayOfWeek, normalizeDaysOfWeekJson } from '../shared/weekday.util';
import { isOnOrAfterGoalCreationDay } from '../shared/schedule-occurrence.util';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface GoalWithRelations {
  id: string;
  userId?: string;
  title: string;
  description: string | null;
  goalKind: string;
  conquestType: string;
  status?: string;
  completed: boolean;
  createdAt: Date;
  schedule: GoalScheduleRecord | null;
  reminder: GoalReminderRecord | null;
  plantedTree?: any;
  user?: any;
}

export interface GoalScheduleRecord {
  id: string;
  goalId: string;
  frequency: string;
  at?: Date | null;
  times?: any; // string[] as Json
  daysOfWeek?: any; // number[] as Json
  durationDays?: number | null;
  timeZone: string;
  dtStart?: Date | null;
  dtEnd?: Date | null;
  extra?: unknown;
}

export interface GoalReminderRecord {
  id: string;
  goalId: string;
  dailyStatus?: string | null;
  slotsToday?: any; // { time: string }[] as Json
  lastSentAt?: Date | null;
  sentCount: number;
  silenceUntil?: Date | null;
  minutesBefore: number;
}

// Adapter: converte qualquer resultado de Goal+relations para o formato legado esperado por
// reminder.service e policy engine (campos no nível raiz do goal)
export function goalToLegacyRecord(goal: any) {
  const sc = goal.schedule;
  const rem = goal.reminder;

  // Reconstituir scheduleConfig no formato antigo
  let scheduleConfig: ScheduleConfig | null = null;
  if (sc) {
    if (sc.frequency === 'ONCE' && sc.at) {
      scheduleConfig = { type: 'once', at: sc.at.toISOString() };
    } else if (sc.frequency === 'DAILY') {
      scheduleConfig = {
        type: 'daily',
        times: Array.isArray(sc.times) ? sc.times : [],
        ...(sc.durationDays != null ? { durationDays: sc.durationDays } : {}),
      } as any;
    } else if (sc.frequency === 'WEEKLY') {
      scheduleConfig = {
        type: 'weekly',
        times: Array.isArray(sc.times) ? sc.times : [],
        daysOfWeek: normalizeDaysOfWeekJson(sc.daysOfWeek),
      } as any;
    } else if (sc.frequency === 'MONTHLY') {
      const extra = sc.extra && typeof sc.extra === 'object' ? (sc.extra as Record<string, unknown>) : {};
      const raw = extra.dayOfMonth;
      const dom =
        typeof raw === 'number'
          ? Math.trunc(raw)
          : typeof raw === 'string'
            ? parseInt(raw, 10)
            : NaN;
      if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
        scheduleConfig = {
          type: 'monthly',
          dayOfMonth: dom,
          times: Array.isArray(sc.times) ? sc.times : [],
        } as any;
      }
    }
  }

  return {
    ...goal,
    // Campos legados reconstruídos para compatibilidade com policy engine
    scheduleConfig,
    reminderTime: null, // migrado para GoalSchedule.at
    reminderSlotsToday: rem?.slotsToday ?? null,
    lastReminderSentAt: rem?.lastSentAt ?? null,
    reminderCount: rem?.sentCount ?? 0,
    dailyStatus: rem?.dailyStatus ?? null,
    silenceUntil: rem?.silenceUntil ?? null,
  };
}

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
   * Cria uma meta de usuário (Goal), a árvore (PlantedTree), o GoalSchedule
   * e o GoalReminder inicial em uma única transação.
   */
  async createUserGoalWithTree(
    data: Omit<CreateUserGoalInput, 'reminderTime'> & { reminderTime?: Date | string; scheduleConfig?: ScheduleConfig },
  ) {
    // 1. Normalizar e validar conquestType
    const normalizedConquest = normalizeConquestType(data.conquestType);
    if (!normalizedConquest) {
      throw new BadRequestException(`conquestType inválido: '${data.conquestType}'. Opções válidas: ${CONQUEST_TYPES.join(', ')}`);
    }

    // 1b. Mapear conquestType → family da árvore
    const conquest = String(normalizedConquest).toLowerCase();
    let family = 'b';
    if (data.goalType && data.goalType.toLowerCase() === 'pontual') {
      switch (true) {
        case conquest.includes('corpo'):    family = 'a'; break;
        case conquest.includes('espiritual'): family = 'b'; break;
        case conquest.includes('financeiro'): family = 'c'; break;
        case conquest.includes('hobby') || conquest.includes('lazer'): family = 'd'; break;
        default: family = 'b';
      }
    } else {
      switch (true) {
        case conquest.includes('corpo') || conquest.includes('espiritual') || conquest.includes('saud') || conquest.includes('agua'): family = 'a'; break;
        case conquest.includes('financeiro'): family = 'c'; break;
        case conquest.includes('hobby') || conquest.includes('lazer'): family = 'd'; break;
        default: family = 'b';
      }
    }

    let type = 'continua';
    const ng = normalizeGoalType(data.goalType as any);
    if (ng === 'Pontual') type = 'pontual';
    else if (ng === 'Continua') type = 'continua';
    else if ('path' in data && typeof (data as any).path === 'string') {
      type = inferTypeFromPath((data as any).path);
    }
    const normalizedGoalType = ng ?? (type === 'pontual' ? 'Pontual' : 'Continua');

    const treeCatalog = await prisma.treeCatalog.findFirst({ where: { family, type } });
    if (!treeCatalog) {
      throw new BadRequestException(`Tipo de árvore (family='${family}', type='${type}') não encontrado no catálogo para conquestType '${data.conquestType}'`);
    }

    // 2. Buscar anchor livre no mundo
    const worldConfig = await prisma.worldConfig.findUnique({ where: { worldId: data.worldId } });
    if (!worldConfig) {
      throw new BadRequestException('Configuração de anchors não encontrada para o mundo: worldConfig ausente.');
    }
    if (!worldConfig.anchors || (Array.isArray(worldConfig.anchors) && worldConfig.anchors.length === 0)) {
      throw new BadRequestException('Configuração de anchors presente mas vazia.');
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
      if (isPontual) { if (at !== 'sky') continue; } else { if (at === 'sky') continue; }
      const exists = await prisma.plantedTree.findFirst({ where: { worldId: data.worldId, anchorId: aid, goal: { is: { userId: data.userId } } } });
      if (!exists) { chosenAnchorId = aid; break; }
    }
    if (!chosenAnchorId) {
      if (isPontual) throw new BadRequestException('Não há anchors livres do tipo "sky" disponíveis para este usuário neste mundo');
      throw new BadRequestException('Não há anchors livres disponíveis para este usuário neste mundo');
    }

    // 3. Validações
    if (!data.userId || typeof data.userId !== 'string' || data.userId.length < 10) {
      throw new Error('userId inválido ao criar meta: ' + String(data.userId));
    }

    // 3a. Determinar timezone do usuário
    let userTimezone = 'America/Sao_Paulo';
    try {
      const u = await prisma.user.findUnique({ where: { id: data.userId }, select: { timezone: true } });
      if (u && (u as any).timezone) userTimezone = (u as any).timezone;
    } catch { /* ignore */ }

    // 3b. Interpreter scheduleConfig → dados do GoalSchedule
    const sc = data.scheduleConfig;
    let scheduleFrequency: string | null = null;
    let scheduleAt: Date | null = null;
    let scheduleTimes: string[] | null = null;
    let scheduleDaysOfWeek: number[] | null = null;
    let scheduleDurationDays: number | null = null;
    let scheduleExtra: Record<string, unknown> | null = null;

    if (sc && typeof sc === 'object') {
      if (sc.type === 'once' && sc.at) {
        scheduleFrequency = 'ONCE';
        const atStr = String(sc.at).trim();
        const timeOnly = atStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (timeOnly) {
          const hh = parseInt(timeOnly[1], 10);
          const mm = parseInt(timeOnly[2], 10);
          const ss = parseInt(timeOnly[3] || '0', 10);
          const dt = DateTime.now().setZone(userTimezone).set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
          scheduleAt = dt.toUTC().toJSDate();
        } else {
          const dt = DateTime.fromISO(atStr, { zone: userTimezone });
          scheduleAt = dt.isValid ? dt.toUTC().toJSDate() : new Date(atStr);
        }
      } else if (sc.type === 'daily' && Array.isArray((sc as any).times) && (sc as any).times.length > 0) {
        scheduleFrequency = 'DAILY';
        scheduleTimes = (sc as any).times;
        scheduleDurationDays = (sc as any).durationDays ?? null;
      } else if (sc.type === 'weekly' && Array.isArray((sc as any).daysOfWeek) && Array.isArray((sc as any).times) && (sc as any).times.length > 0) {
        scheduleFrequency = 'WEEKLY';
        scheduleTimes = (sc as any).times;
        scheduleDaysOfWeek = normalizeDaysOfWeekJson((sc as any).daysOfWeek);
      } else if (sc.type === 'monthly' && Array.isArray((sc as any).times) && (sc as any).times.length > 0) {
        const rawDom = (sc as any).dayOfMonth;
        const dom =
          typeof rawDom === 'number' ? Math.trunc(rawDom) : parseInt(String(rawDom), 10);
        if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
          scheduleFrequency = 'MONTHLY';
          scheduleTimes = (sc as any).times;
          scheduleExtra = { dayOfMonth: dom };
        }
      }
    }

    // Legado: reminderTime sem scheduleConfig
    if (!scheduleFrequency && data.reminderTime) {
      scheduleFrequency = normalizedGoalType === 'Pontual' ? 'ONCE' : 'DAILY';
      try {
        if (typeof data.reminderTime === 'string') {
          const s = data.reminderTime.trim();
          const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (timeOnly) {
            const hh = parseInt(timeOnly[1], 10);
            const mm = parseInt(timeOnly[2], 10);
            let dt = DateTime.now().setZone(userTimezone).set({ hour: hh, minute: mm, second: Number(timeOnly[3] || 0), millisecond: 0 });
            if (dt <= DateTime.now().setZone(userTimezone)) dt = dt.plus({ days: 1 });
            if (scheduleFrequency === 'ONCE') scheduleAt = dt.toUTC().toJSDate();
            else scheduleTimes = [`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`];
          } else {
            const dt = DateTime.fromISO(s, { zone: userTimezone });
            if (dt.isValid) {
              if (scheduleFrequency === 'ONCE') scheduleAt = dt.toUTC().toJSDate();
              else scheduleTimes = [`${String(dt.hour).padStart(2,'0')}:${String(dt.minute).padStart(2,'0')}`];
            }
          }
        } else if (data.reminderTime instanceof Date) {
          const dt = DateTime.fromJSDate(data.reminderTime).setZone(userTimezone);
          if (scheduleFrequency === 'ONCE') scheduleAt = dt.toUTC().toJSDate();
          else scheduleTimes = [`${String(dt.hour).padStart(2,'0')}:${String(dt.minute).padStart(2,'0')}`];
        }
      } catch { /* ignore */ }
    }

    // 3c. Título/descrição (gera via IA se vazio)
    let title = data.title || '';
    let description = data.description || '';
    if ((!title || !description) && data.userId) {
      try {
        const md = await this.communicationService.generateProgressMetadata(data.userId, { goalTitle: title });
        title = title || md.title;
        description = description || md.description;
      } catch { /* ignore */ }
    }

    // 4. Transação: PlantedTree → GrowthEvent → Goal → GoalSchedule → GoalReminder
    const txResult = await prisma.$transaction(async (tx) => {
      const planted = await tx.plantedTree.create({
        data: {
          worldId: data.worldId,
          anchorId: chosenAnchorId,
          treeCatalogId: treeCatalog.id,
          actualStage: 1,
        },
      });

      await tx.growthEvent.create({
        data: {
          plantedTreeId: planted.id,
          stage: 1,
          progressIndex: 1,
          title,
          description,
        },
      });

      const goal = await tx.goal.create({
        data: {
          userId: data.userId,
          title,
          description,
          conquestType: normalizedConquest,
          goalKind: normalizedGoalType,
          plantedTreeId: planted.id,
        },
      });

      // Criar GoalSchedule se há configuração de agendamento
      if (scheduleFrequency) {
        await tx.goalSchedule.create({
          data: {
            goalId: goal.id,
            frequency: scheduleFrequency,
            timeZone: userTimezone,
            at: scheduleAt ?? undefined,
            times: scheduleTimes ?? undefined,
            daysOfWeek: scheduleDaysOfWeek ?? undefined,
            durationDays: scheduleDurationDays ?? undefined,
            extra: scheduleExtra ? (scheduleExtra as Prisma.InputJsonValue) : undefined,
            dtStart: scheduleAt ?? (scheduleTimes ? DateTime.now().setZone(userTimezone).toJSDate() : undefined),
          },
        });
      }

      // Criar GoalReminder com estado inicial
      await tx.goalReminder.create({
        data: {
          goalId: goal.id,
          dailyStatus: null,
          sentCount: 0,
          minutesBefore: 0,
        },
      });

      return { planted, goal };
    });

    const plantedTreeFull = await prisma.plantedTree.findUnique({
      where: { id: txResult.planted.id },
      include: { treeCatalog: true },
    });

    this.worldsGateway.emitTreePlanted(data.worldId, plantedTreeFull);
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
      await prisma.goalReminder.upsert({
        where: { goalId },
        update: { dailyStatus: 'DONE', silenceUntil: null },
        create: { goalId, dailyStatus: 'DONE', sentCount: 0 },
      });
      return prisma.goal.findUnique({ where: { id: goalId } });
    }

    await prisma.goalReminder.upsert({
      where: { goalId },
      update: { dailyStatus: 'DONE', silenceUntil: null },
      create: { goalId, dailyStatus: 'DONE', sentCount: 0 },
    });
    return prisma.goal.update({
      where: { id: goalId },
      data: { completed: true },
    });
  }

  async updateReminderState(
    goalId: string,
    data: { dailyStatus?: string | null; silenceUntil?: Date | null },
  ) {
    return prisma.goalReminder.upsert({
      where: { goalId },
      update: {
        ...(data.dailyStatus !== undefined ? { dailyStatus: data.dailyStatus } : {}),
        ...(data.silenceUntil !== undefined ? { silenceUntil: data.silenceUntil } : {}),
      },
      create: {
        goalId,
        dailyStatus: data.dailyStatus ?? null,
        silenceUntil: data.silenceUntil ?? null,
        sentCount: 0,
      },
    });
  }

  /**
   * Busca metas ativas para lembretes (com schedule e reminder incluídos)
   */
  async getActiveGoalsForReminders() {
    const goals = await prisma.goal.findMany({
      where: {
        completed: false,
        schedule: {
          isNot: null,
        },
      },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        goalKind: true,
        conquestType: true,
        completed: true,
        createdAt: true,
        schedule: {
          select: {
            id: true,
            goalId: true,
            frequency: true,
            at: true,
            times: true,
            daysOfWeek: true,
            durationDays: true,
            timeZone: true,
            dtStart: true,
            dtEnd: true,
            extra: true,
          },
        },
        reminder: {
          select: {
            id: true,
            goalId: true,
            dailyStatus: true,
            slotsToday: true,
            lastSentAt: true,
            sentCount: true,
            silenceUntil: true,
            minutesBefore: true,
          },
        },
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

    return goals.map(goalToLegacyRecord);
  }

  async getGoalsByIds(goalIds: string[]) {
    if (goalIds.length === 0) return [];
    return prisma.goal.findMany({
      where: { id: { in: goalIds } },
      select: { id: true, title: true },
    });
  }

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
        reminder: {
          lastSentAt: { gte: todayStart, lte: todayEnd },
          dailyStatus: {
            in: [
              'WAITING_OPERATIONAL_REPLY',
              'WAITING_FOLLOW_UP_REPLY',
              'WAITING_REACTIVATION_REPLY',
              'MISSED',
            ],
          },
        },
      },
      select: {
        id: true,
        title: true,
        reminder: { select: { dailyStatus: true } },
      },
    });

    return ignored.map((g) => ({
      id: g.id,
      title: g.title,
      dailyStatus: g.reminder?.dailyStatus ?? null,
    }));
  }

  async getGoalsForTodayWithStatus(userId: string, timezone = 'America/Sao_Paulo') {
    const todayGoals = await this.getGoalsForTodayForUser(userId, timezone);
    const now = DateTime.now().setZone(timezone).toJSDate();

    const goals = await prisma.goal.findMany({
      where: {
        userId,
        id: { in: todayGoals.map((g: any) => g.id) },
        completed: false,
      },
      select: {
        id: true,
        title: true,
        completed: true,
        reminder: { select: { dailyStatus: true, silenceUntil: true } },
      },
    });

    return goals
      .filter((g) => {
        const silenceUntil = g.reminder?.silenceUntil ? new Date(g.reminder.silenceUntil) : null;
        if (silenceUntil && silenceUntil > now) return false;
        return true;
      })
      .map((g) => ({
        id: g.id,
        title: g.title,
        completed: g.completed,
        dailyStatus: g.reminder?.dailyStatus ?? null,
        silenceUntil: g.reminder?.silenceUntil ?? null,
      }));
  }

  async getGoalsForDateForUser(
    userId: string,
    targetDate: DateTime,
    timezone = 'America/Sao_Paulo',
    options?: { includeCompleted?: boolean },
  ) {
    const all = await this.getGoalsForUser(userId);
    const targetDow = luxonWeekdayToJsDayOfWeek(targetDate.weekday);
    const targetStart = targetDate.startOf('day');

    return all.filter((g: any) => {
      const isPontualCompleted = g.goalKind === 'Pontual' && g.completed === true;
      if (!(options?.includeCompleted ?? false) && isPontualCompleted) return false;

      if (!isOnOrAfterGoalCreationDay(targetDate, g.createdAt, timezone)) return false;

      // Ler do scheduleConfig reconstruído (adapter)
      const sc = g.scheduleConfig as ScheduleConfig | null;
      if (sc && typeof sc === 'object') {
        if (sc.type === 'once') {
          const at = new Date(sc.at);
          const userAt = DateTime.fromJSDate(at).setZone(timezone);
          return userAt.hasSame(targetStart, 'day');
        }
        if (sc.type === 'daily') {
          if ((sc as any).durationDays) {
            const createdAt = DateTime.fromJSDate(new Date(g.createdAt)).setZone(timezone);
            const daysSince = Math.floor(targetDate.diff(createdAt, 'days').days);
            return daysSince < (sc as any).durationDays;
          }
          return true;
        }
        if (sc.type === 'weekly') {
          return normalizeDaysOfWeekJson((sc as any).daysOfWeek).includes(targetDow);
        }
        if (sc.type === 'monthly') {
          const dom =
            typeof (sc as any).dayOfMonth === 'number'
              ? Math.trunc((sc as any).dayOfMonth)
              : parseInt(String((sc as any).dayOfMonth), 10);
          if (!Number.isFinite(dom) || dom < 1 || dom > 31) return false;
          return targetStart.day === dom;
        }
      }
      return false;
    });
  }

  async getGoalsForTodayForUser(userId: string, timezone = 'America/Sao_Paulo') {
    const now = DateTime.now().setZone(timezone);
    return this.getGoalsForDateForUser(userId, now, timezone, { includeCompleted: false });
  }

  async getGoalsForTomorrowForUser(userId: string, timezone = 'America/Sao_Paulo') {
    const now = DateTime.now().setZone(timezone);
    const tomorrow = now.plus({ days: 1 });
    return this.getGoalsForDateForUser(userId, tomorrow, timezone, { includeCompleted: false });
  }

  async getGoalsForUser(userId: string) {
    const goals = await prisma.goal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        description: true,
        goalKind: true,
        conquestType: true,
        completed: true,
        createdAt: true,
        schedule: {
          select: {
            id: true,
            goalId: true,
            frequency: true,
            at: true,
            times: true,
            daysOfWeek: true,
            durationDays: true,
            timeZone: true,
            extra: true,
          },
        },
        reminder: {
          select: {
            id: true,
            goalId: true,
            dailyStatus: true,
            slotsToday: true,
            lastSentAt: true,
            sentCount: true,
            silenceUntil: true,
          },
        },
        plantedTree: {
          select: {
            id: true,
            anchorId: true,
            actualStage: true,
            createdAt: true,
            treeCatalog: {
              select: { family: true, type: true },
            },
            growthEvents: {
              select: { id: true, stage: true, createdAt: true, title: true, description: true, progressIndex: true },
              orderBy: { createdAt: 'desc' },
              take: 30,
            },
          },
        },
      },
    });

    return goals.map(goalToLegacyRecord);
  }
}
