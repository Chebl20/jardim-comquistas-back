import { Injectable } from '@nestjs/common';
import { UserGoalService } from '../goals/user-goal.service';
import { WorldsEventsService } from '../worlds/worlds.events.service';
import { AiService } from './openIa/ai.service';

@Injectable()
export class IntentRouter {
  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly worldsEventsService: WorldsEventsService,
    private readonly aiService: AiService,
  ) {}

  async route(action: any) {
    console.log('[IntentRouter] action received:', action?.intent, action?.data);
    switch (action.intent) {
      case 'CREATE_GOAL': {
        const { title, description, goalType, conquestType, frequency, reminderTime, userId, worldId, reply } = action.data || {};

        if (!reminderTime) {
          if (reply && typeof reply === 'function') {
            reply('Qual o melhor horário para te lembrar dessa meta? (Ex: 08:00, 20:30)');
          } else {
            console.log('Perguntar ao usuário: Qual o melhor horário para te lembrar dessa meta?');
          }
          break;
        }
        try {
              const payload = {
            userId,
            title,
            description,
            goalType,
            conquestType,
            frequency,
            reminderTime: reminderTime ? new Date(reminderTime) : undefined,
            worldId: "mundo2",
          };
          const userGoal = await this.userGoalService.createUserGoalWithTree(payload);
          console.log('Meta criada:', userGoal);
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
      case 'SET_TIME':
        console.log('Definir horário', action.data);
        break;
      case 'MARK_DONE': {
        let { plantedTreeId, goalId, title, description, worldId, userId, reply } = action.data || {};
        const wId = worldId || 'mundo2';
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

          const out = await this.worldsEventsService.progressPlantedTree(wId, { plantedTreeId, goalId, title, description, userId });
          console.log('Progresso registrado:', out);
          if (reply && typeof reply === 'function') reply('Progresso registrado com sucesso.');
        } catch (err) {
          console.error('Erro ao registrar progresso:', err);
          if (reply && typeof reply === 'function') reply('Erro ao registrar progresso: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
        }
        break;
      }
      case 'CANCEL_GOAL':
        console.log('Cancelar');
        break;
    }
  }
}
