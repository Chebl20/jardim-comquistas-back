import { Injectable, Logger } from '@nestjs/common';
import { UserGoalService } from '../goals/user-goal.service';
import { WorldsEventsService } from '../worlds/worlds.events.service';
import { AiService } from './openIa/ai.service';
import { RulesService } from './rules.service';
import { CommunicationService } from '../shared/communication.service';
import { prisma } from '../../prisma/client';
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
    private readonly aiService: AiService,
    private readonly rulesService: RulesService,
    private readonly communicationService: CommunicationService,
    private readonly worldsService: WorldsService,
  ) {}

  async route(action: any) {
    this.logger.log(`action received: intent=${action?.intent}, data=${JSON.stringify(action?.data)}`);
    switch (action.intent) {
      case 'CREATE_GOAL': {
        let { title, description, goalType, conquestType, frequency, reminderTime, time, userId, worldId, reply } = action.data || {};

        let calculatedReminderTime = reminderTime;
        if (time && !reminderTime) {
          // Calcular tempo relativo
          const now = new Date();
          if (time === '1_minute') {
            calculatedReminderTime = new Date(now.getTime() + 1 * 60 * 1000).toISOString();
          } else if (time === '30_min') {
            calculatedReminderTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
          } else if (time === '1_hour') {
            calculatedReminderTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
          } else if (time === 'tomorrow') {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0); // 9 AM tomorrow
            calculatedReminderTime = tomorrow.toISOString();
          } else if (time === 'next_cycle') {
            // Para metas recorrentes, próximo ciclo
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            calculatedReminderTime = tomorrow.toISOString();
          }
        }

        // Regra de segurança: se a action vier com tempo/reminderTime mas sem goalType, assumir Pontual
        if ((!goalType || goalType === undefined || goalType === null || String(goalType).trim() === '') && (calculatedReminderTime || reminderTime || time)) {
          goalType = 'Pontual';
        }

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
              const meta = await this.aiService.generateProgressMetadata(userId, { goalTitle });
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
