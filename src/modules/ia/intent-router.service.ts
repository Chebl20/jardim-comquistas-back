import { Injectable, Logger } from '@nestjs/common';
import { UserGoalService } from '../goals/user-goal.service';
import { WorldsEventsService } from '../worlds/worlds.events.service';
import { AiService } from './openIa/ai.service';
import { RulesService } from './rules.service';
import { CommunicationService } from '../shared/communication.service';
import { prisma } from '../../prisma/client';
import { WorldsService } from '../worlds/worlds.service';

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

        // Se não houver goalType e não houver tempo, perguntar ao usuário se é pontual ou contínua
        if (!goalType || String(goalType).trim() === '') {
          if (reply && typeof reply === 'function') {
            reply('Essa meta é Pontual (única) ou Continua (recorrente)? Responda "Pontual" ou "Continua".');
          } else {
            this.logger.log('Perguntar ao usuário: Essa meta é Pontual ou Continua?');
          }
          break;
        }

        // Se não houver horário calculado, pedir horário
        if (!calculatedReminderTime) {
          if (reply && typeof reply === 'function') {
            reply('Qual o melhor horário para te lembrar dessa meta? (Ex: 08:00, 20:30)');
          } else {
            this.logger.log('Perguntar ao usuário: Qual o melhor horário para te lembrar dessa meta?');
          }
          break;
        }
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
          await prisma.userGoal.update({
            where: { id: goalId },
            data: {
              goalType: 'Continua',
              frequency,
              reminderTime: reminderTime ? new Date(reminderTime) : undefined,
            },
          });
          this.logger.log(`Meta ${goalId} tornada recorrente`);
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
