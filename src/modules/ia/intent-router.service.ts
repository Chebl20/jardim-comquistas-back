import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { UserGoalService } from '../goals/user-goal.service';
import { ClarificationNucleus } from './nuclei/clarification';
import { WorldsEventsService } from '../worlds/worlds.events.service';
import { RulesService } from './rules.service';
import { CommunicationService } from '../shared/communication.service';
import { prisma } from '../../prisma/client';
import { ConversationSessionService } from '../shared/conversation-session.service';
import { WorldsService } from '../worlds/worlds.service';
import { normalizeConquestType, CONQUEST_TYPES } from './conquest-type.enum';
import { normalizeGoalType, GOAL_TYPES } from './goal-type.util';
import { createAskInfo } from './ask-info.util';

@Injectable()
export class IntentRouter {
  private readonly logger = new Logger(IntentRouter.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly worldsEventsService: WorldsEventsService,
    private readonly rulesService: RulesService,
    private readonly communicationService: CommunicationService,
    private readonly worldsService: WorldsService,
    private readonly conversationSession: ConversationSessionService,
    private readonly clarification: ClarificationNucleus,
  ) {}

  async route(action: any) {
    this.logger.log(`action received: intent=${action?.intent}, data=${JSON.stringify(action?.data)}`);

    // ASK_INFO should be handled by the conversational layer (TelegramService / ConversationSession).
    // Do not auto-convert ASK_INFO to CREATE_GOAL here; return early to avoid taking actions without confirmation.
    if (action && action.intent === 'ASK_INFO') {
      this.logger.log('ASK_INFO reached IntentRouter - ignoring because it should be handled by ConversationSession layer');
      return;
    }
    switch (action.intent) {
      case 'CREATE_GOAL': {
        let { title, description, goalType, conquestType, frequency, reminderTime, time, userId, worldId, reply } = action.data || {};

        // Se existir uma ConversationSession ativa e não estiver em CONFIRM, bloquear criação
        try {
          const session = await prisma.conversationSession.findUnique({ where: { userId } });
          if (session && session.state !== 'CONFIRM') {
            this.logger.log(`CREATE_GOAL bloqueado: existe sessão ativa (state=${session.state}) para user=${userId}`);
            // Não prosseguir com criação enquanto houver sessão não confirmada
            break;
          }
        } catch (e) {
          // ignore absence of table or errors
        }

        let calculatedReminderTime = reminderTime;
        if (time && !reminderTime) {
          // Calcular tempo relativo — considerar timezone do usuário quando possível
          let tz = 'UTC';
          try {
            const uFull = await prisma.user.findUnique({ where: { id: userId } });
            if (uFull && (uFull as any).timezone) tz = (uFull as any).timezone;
          } catch (e) {
            // ignore
          }
          const now = DateTime.now().setZone(tz);
          if (time === '1_minute') {
            calculatedReminderTime = now.plus({ minutes: 1 }).toUTC().toISO();
          } else if (time === '30_min') {
            calculatedReminderTime = now.plus({ minutes: 30 }).toUTC().toISO();
          } else if (time === '1_hour') {
            calculatedReminderTime = now.plus({ hours: 1 }).toUTC().toISO();
          } else if (time === 'tomorrow') {
            const tomorrow = now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
            calculatedReminderTime = tomorrow.toUTC().toISO();
          } else if (time === 'next_cycle') {
            const tomorrow = now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
            calculatedReminderTime = tomorrow.toUTC().toISO();
          }
        }

        // Regra de segurança: se a action vier sem `goalType`, NÃO deduza automaticamente.
        // Em vez disso, force a solicitação ao usuário para escolher entre as opções.
        // (Anteriormente havia heurística que tentava inferir Pontual/Continua — removida.)

        // Normalizar e validar goalType em runtime (sem alterar Prisma)
        const normalizedGoalType = normalizeGoalType(goalType);
        if (!normalizedGoalType) {
          // perguntar com opções padronizadas
          if (reply && typeof reply === 'function') {
            reply(`Por favor escolha o tipo da meta: ${GOAL_TYPES.join(' / ')}`);
          }
          // envia ASK_INFO padronizado
          const ask = createAskInfo('goalType', GOAL_TYPES.slice(), 'Essa meta é Pontual (única) ou Continua (recorrente)?');
          // se reply for função, também invocamos com o prompt
          if (reply && typeof reply === 'function') reply(ask.data.prompt || 'Qual o tipo?');
          // não prossegue com criação
          break;
        }
        goalType = normalizedGoalType;

        // Se não houver horário calculado, pedir horário
        if (!calculatedReminderTime) {
          if (reply && typeof reply === 'function') {
            reply('Qual o melhor horário para te lembrar dessa meta? (Ex: 08:00, 20:30)');
          } else {
            this.logger.log('Perguntar ao usuário: Qual o melhor horário para te lembrar dessa meta?');
          }
          break;
        }
        // normalizar e validar conquestType
        const normalizedConquest = normalizeConquestType(conquestType || '');
        if (!normalizedConquest) {
          if (reply && typeof reply === 'function') {
            reply(`Qual o tipo dessa conquista? Escolha uma das opções: ${CONQUEST_TYPES.join(', ')}`);
          } else {
            this.logger.log('Perguntar ao usuário: escolha conquestType dentre opções.');
          }
          break;
        }
        conquestType = normalizedConquest;

        try {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          const worldId = user?.currentWorldId || (await this.worldsService.getDefaultWorld())?.worldId || 'mundo2';

          // Garantir que reminderTime esteja no futuro relativo ao timezone do usuário
          if (calculatedReminderTime) {
            try {
              const tz = (user && (user as any).timezone) ? (user as any).timezone : 'America/Sao_Paulo';
              let dt = typeof calculatedReminderTime === 'string'
                ? DateTime.fromISO(calculatedReminderTime, { zone: tz })
                : DateTime.fromJSDate(new Date(calculatedReminderTime)).setZone(tz);
              const nowLocal = DateTime.now().setZone(tz);
              // Se a data/parsing for inválida, fallback não altera
              if (dt.isValid) {
                // Se estiver no passado (<= agora) ou muito próximo no passado, ajustar para agora+1min
                if (dt <= nowLocal) {
                  dt = nowLocal.plus({ minutes: 1 });
                  calculatedReminderTime = dt.toUTC().toISO();
                } else {
                  // assegura que stored iso esteja em UTC
                  calculatedReminderTime = dt.toUTC().toISO();
                }
              }
            } catch (e) {
              // ignore normalization errors
            }
          }
          const payload = {
            userId,
            title,
            description: (description && String(description).trim()) ? description : (title ? `Lembrete: ${title}` : 'Lembrete rápido'),
            goalType,
            conquestType,
            frequency,
            reminderTime: calculatedReminderTime ? new Date(calculatedReminderTime) : undefined,
            worldId,
          };
          const userGoal = await this.userGoalService.createUserGoalWithTree(payload);
          this.logger.log(`Meta criada: ${JSON.stringify(userGoal)}`);
          try {
            if (action && typeof action.reply === 'function') {
              const tz = (user && (user as any).timezone) ? (user as any).timezone : 'UTC';
              const when = userGoal.reminderTime ? DateTime.fromJSDate(new Date(userGoal.reminderTime)).setZone(tz).toFormat('yyyy-LL-dd HH:mm') : 'agora';
              action.reply(`✅ Meta criada: ${userGoal.title}. Vou te lembrar em ${when}.`);
            }
          } catch (e) {
            // não bloquear fluxo principal por erro de reply
            this.logger.warn('Falha ao enviar reply após criação de meta', e);
          }
          // Reset conversation session state and payload to ensure no leftover context remains
          try {
            const existingSession = await this.conversationSession.getSession(userId);
            const preservedPayload: any = existingSession && existingSession.payload && Array.isArray((existingSession.payload as any).recentMessages)
              ? { recentMessages: (existingSession.payload as any).recentMessages }
              : {};
            await this.conversationSession.createSession(userId, 'IDLE', preservedPayload);
            // After creating the goal, forward to Clarification to produce
            // the same post-flow reply behavior as the conversational path.
            try {
              const clarInput = { userId: userId as any, currentSession: 'IDLE', text: '', meta: { user: { id: userId } } } as any;
              const clar = await this.clarification.analyze(clarInput as any);
              if (action && typeof action.reply === 'function' && clar && clar.suggestedReply) {
                action.reply(String(clar.suggestedReply || ''));
              }
            } catch (e) {
              // ignore clarification errors and keep original reply
            }
          } catch (e) {
            this.logger.warn('Falha ao resetar sessão após criação de meta', e);
          }
        } catch (err) {
          if (err && typeof err === 'object') {
            if ('response' in err) {
              console.error('Erro ao criar meta:', (err as any).response?.data || (err instanceof Error ? err.message : JSON.stringify(err)) || err);
            } else if (err instanceof Error) {
              console.error('Erro ao criar meta:', err.message);
            } else {
              console.error('Erro ao criar meta:', JSON.stringify(err));
            }
          } else {
            console.error('Erro ao criar meta:', err);
          }
        }
        break;
      }
      case 'MAKE_RECURRING': {
        const { goalId, frequency, reminderTime } = action.data || {};
        this.logger.log(`Tornar meta recorrente: goalId=${goalId}, frequency=${frequency}, reminderTime=${reminderTime}`);
        try {
          // Buscar meta atual
          const existing = await prisma.userGoal.findUnique({ where: { id: goalId }, include: { plantedTree: true } });
          if (!existing) {
            this.logger.warn(`Meta não encontrada para tornar recorrente: ${goalId}`);
            break;
          }

          const ngt = normalizeGoalType(existing.goalType);
          // Se a meta atual for Pontual, NÃO a alteramos: em vez disso, criamos uma nova meta contínua baseada nela
          if (ngt === 'Pontual') {
            // Informar (se possível) que vamos criar uma nova meta contínua em vez de alterar a pontual
            if (action.reply && typeof action.reply === 'function') {
              action.reply('Essa meta é Pontual. Vou criar uma nova meta contínua baseada nela (não alterarei a meta original).');
            } else {
              this.logger.log('Criando nova meta contínua baseada em meta pontual (não alterando a original)');
            }

            // Coerce frequency for payload
            let frequencyForCreate: number | string | undefined = undefined;
            if (typeof frequency === 'number') frequencyForCreate = frequency;
            else if (typeof frequency === 'string') {
              const n = parseInt(frequency.replace(/[^0-9]/g, ''), 10);
              frequencyForCreate = !isNaN(n) ? n : undefined;
            }

            const payload = {
              userId: existing.userId,
              title: existing.title || `Continua: ${existing.title || 'Nova meta'}`,
              description: existing.description || existing.title || undefined,
              goalType: 'Continua',
              conquestType: existing.conquestType,
              frequency: frequencyForCreate,
              reminderTime: reminderTime ? new Date(reminderTime) : undefined,
              worldId: existing.plantedTree?.worldId || (await this.worldsService.getDefaultWorld())?.worldId || 'mundo2',
            } as any;

            const newGoal = await this.userGoalService.createUserGoalWithTree(payload);
            if (action.reply && typeof action.reply === 'function') action.reply(`Criei uma nova meta contínua: ${newGoal.id}`);
            this.logger.log(`Nova meta contínua criada a partir de pontual: ${newGoal.id}`);
          } else {
            // Já é contínua — atualizamos os campos coerentemente
            // Coerce frequency: accept number or string like '3' or '3x' -> 3. If non-numeric string, store null.
            let frequencyInt: number | null = null;
            if (typeof frequency === 'number') frequencyInt = frequency;
            else if (typeof frequency === 'string') {
              const n = parseInt(frequency.replace(/[^0-9]/g, ''), 10);
              frequencyInt = !isNaN(n) ? n : null;
            }

            await prisma.userGoal.update({
              where: { id: goalId },
              data: {
                goalType: 'Continua',
                frequency: frequencyInt,
                reminderTime: reminderTime ? new Date(reminderTime) : undefined,
              },
            });
            this.logger.log(`Meta ${goalId} tornada/atualizada como recorrente`);
          }
        } catch (err) {
          console.error('Erro ao tornar meta recorrente:', err);
        }
        break;
      }
      case 'SET_TIME':
        this.logger.log(`Definir horário: ${JSON.stringify(action.data)}`);
        break;
      case 'MARK_DONE': {
        let { plantedTreeId, goalId, title, description, worldId, userId, reply } = action.data || {};

        // Encontrar a meta pelo ID (goalId é o ID único)
        const goal = await prisma.userGoal.findUnique({ where: { id: goalId }, include: { plantedTree: true } });
        if (!goal) {
          this.logger.warn(`Meta não encontrada: id=${goalId}, userId=${userId}`);
          if (reply && typeof reply === 'function') reply('Meta não encontrada.');
          break;
        }

        // Verificar se a meta pertence ao usuário
        if (goal.userId !== userId) {
          this.logger.warn(`Meta não pertence ao usuário: goalId=${goalId}, userId=${userId}`);
          if (reply && typeof reply === 'function') reply('Meta não encontrada.');
          break;
        }

        // Verificar regra com o ID real
        if (!(await this.rulesService.canMarkDone(goal.id))) {
          this.logger.warn(`Não pode marcar como feito: goalId=${goal.id}`);
          if (reply && typeof reply === 'function') reply('Não é possível marcar essa meta como feita.');
          break;
        }

        try {
          // Se não vier title/description, peça à IA para gerar metadata concisa
          if ((!title || !title.trim()) || (!description || !description.trim())) {
            try {
              const goalTitle = action.data?.goalTitle || action.data?.title || undefined;
              const meta = await this.communicationService.generateProgressMetadata(userId, { goalTitle });
              title = title && title.trim() ? title : meta.title || '';
              description = description && description.trim() ? description : meta.description || '';
            } catch (e) {
              // ignore generation errors — seguimos com strings vazias se falhar
            }
          }

          // Usar o worldId da árvore plantada, não do contexto do usuário
          const actualWorldId = goal.plantedTree?.worldId || worldId || 'mundo2';
          const out = await this.worldsEventsService.progressPlantedTree(actualWorldId, { plantedTreeId: goal.plantedTreeId, goalId: goal.id, title, description, userId });
          this.logger.log(`Progresso registrado: ${JSON.stringify(out)}`);
          // Atualizar dailyStatus
          await prisma.userGoal.update({
            where: { id: goal.id },
            data: { dailyStatus: 'DONE' },
          });

          // Se a meta for Pontual, marcamos como concluída para evitar novos lembretes
          try {
            const ng = normalizeGoalType(goal.goalType);
            if (ng === 'Pontual') {
              await this.userGoalService.completeGoal(goal.id);
            }
          } catch (e) {
            // não bloquear o fluxo principal em caso de erro ao marcar como concluída
            this.logger.warn(`Falha ao marcar meta como completed: ${e}`);
          }
          if (reply && typeof reply === 'function') reply('Progresso registrado com sucesso.');
        } catch (err) {
          console.error('Erro ao registrar progresso:', err);
          if (reply && typeof reply === 'function') reply('Erro ao registrar progresso: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
        }
        break;
      }
      case 'ABANDON_GOAL': {
        const { goalId } = action.data || {};

        // Verificar regra
        if (!(await this.rulesService.canAbandonGoal(goalId))) {
          this.logger.warn(`Não pode abandonar meta: goalId=${goalId}`);
          break;
        }

        this.logger.log(`Abandonar meta: ${goalId}`);
        await prisma.userGoal.update({
          where: { id: goalId },
          data: { dailyStatus: 'SKIPPED' },
        });
        break;
      }
      case 'RESCHEDULE_REMINDER': {
        const { goalId, when, time } = action.data || {};

        // Verificar regra
        if (!(await this.rulesService.canRescheduleGoal(goalId))) {
          this.logger.warn(`Não pode reagendar lembrete: goalId=${goalId}`);
          break;
        }

        this.logger.log(`Reagendar lembrete: goalId=${goalId}, when=${when}, time=${time}`);
        // Lógica para reagendar
        const now = new Date();
        let newReminderTime = now;
        if (when === 'today') {
          if (time === 'morning') newReminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
          else if (time === 'afternoon') newReminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0);
          else if (time === 'evening') newReminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0);
          else if (time === '1_minute') newReminderTime = new Date(now.getTime() + 1 * 60 * 1000);
          else if (time === '30_min') newReminderTime = new Date(now.getTime() + 30 * 60 * 1000);
          // Adicionar mais se necessário
        }
        // Atualizar lastReminderSentAt para permitir reenvio
        await prisma.userGoal.update({
          where: { id: goalId },
          data: { 
            lastReminderSentAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Simular enviado ontem
            dailyStatus: 'WAITING',
          },
        });
        break;
      }
    }
  }
}
