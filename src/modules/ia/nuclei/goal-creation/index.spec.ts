import { GoalCreationNucleus } from './index';
import { ConversationActionExecutorService } from '../../conversation/conversation-action-executor.service';
import { CLASSIFICATIONS, FLOW_STATES, CreateGoalAction } from '../../conversation/flow.types';

describe('Goal creation hardening', () => {
  it('normaliza conquestType inválido e converte reminderTime relativo antes de persistir', async () => {
    const llm = {
      analyze: jest.fn().mockResolvedValue({
        classification: CLASSIFICATIONS.CONTINUE,
        confidence: 0.99,
        extracted: {
          payload: {
            title: 'Tomar remédio',
            goalType: 'Pontual',
            conquestType: 'Saúde',
            reminderTime: '+1min',
          },
        },
        suggestedReply: 'Anotado! Vou te lembrar em instantes.',
        finished: true,
      }),
    };
    const comm = {
      generateProgressMetadata: jest.fn().mockResolvedValue({
        title: 'Tomar remédio',
        description: 'Progresso em Tomar remédio',
      }),
    };

    const nucleus = new GoalCreationNucleus(llm as any, comm as any);
    const result = await nucleus.analyze({
      userId: 'user-1234567890',
      currentSession: FLOW_STATES.GOAL_CREATION,
      text: 'me lembra de tomar remédio daqui a 1 minuto',
      meta: {},
    });

    expect(result.decision).toBe('handled');
    expect(result.actions).toHaveLength(1);

    const action = result.actions[0] as CreateGoalAction;
    expect(action.type).toBe('create_goal');
    expect(action.payload.conquestType).toBe('Corpo');
    expect(action.payload.goalType).toBe('Pontual');
    expect(typeof action.payload.reminderTime).toBe('string');
    expect(Number.isNaN(Date.parse(action.payload.reminderTime!))).toBe(false);
    expect(action.successReply).toContain('Anotado! Vou te lembrar em instantes.');
    expect(action.successReply).toContain('📅 Quando vou te lembrar');
    expect(action.payload.scheduleConfig).toEqual({ type: 'once', at: action.payload.reminderTime });
  });

  it('não cria meta quando o payload final ainda está incompleto', async () => {
    const llm = {
      analyze: jest.fn().mockResolvedValue({
        classification: CLASSIFICATIONS.CONTINUE,
        confidence: 0.92,
        extracted: {
          payload: {
            goalType: 'Pontual',
            conquestType: 'Corpo',
          },
        },
        suggestedReply: 'Anotado!',
        finished: true,
      }),
    };
    const comm = {
      generateProgressMetadata: jest.fn().mockRejectedValue(new Error('metadata unavailable')),
    };

    const nucleus = new GoalCreationNucleus(llm as any, comm as any);
    const result = await nucleus.analyze({
      userId: 'user-1234567890',
      currentSession: FLOW_STATES.GOAL_CREATION,
      text: 'isso',
      meta: {},
    });

    expect(result.decision).toBe('handled');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      type: 'continue',
      to: FLOW_STATES.GOAL_CREATION,
    });
    expect(result.actions[1]).toMatchObject({
      type: 'reply',
      text: 'Qual meta você quer criar exatamente?',
    });
  });

  it('envia reply de falha e nunca reply de sucesso quando a persistência quebra', async () => {
    const stateService = {
      appendAssistantMessage: jest.fn(),
      continueFlow: jest.fn(),
      redirectFlow: jest.fn(),
      resetFlow: jest.fn(),
    };
    const userGoalService = {
      createUserGoalWithTree: jest.fn().mockRejectedValue(new Error('db down')),
      completeGoal: jest.fn(),
    };
    const worldsEventsService = {
      progressPlantedTree: jest.fn(),
    };

    const executor = new ConversationActionExecutorService(
      stateService as any,
      userGoalService as any,
      worldsEventsService as any,
    );

    const result = await executor.execute(
      'user-1234567890',
      [
        {
          type: 'create_goal',
          payload: {
            title: 'Ler',
            description: 'Progresso em Ler',
            goalType: 'Pontual',
            conquestType: 'Mente',
            reminderTime: new Date().toISOString(),
          },
          successReply: 'Meta criada com sucesso!',
          failureReply: 'Não consegui salvar essa meta agora. Quer que eu tente de novo com você?',
        } as CreateGoalAction,
      ],
      'world-1',
    );

    expect(result.reply).toBe('Não consegui salvar essa meta agora. Quer que eu tente de novo com você?');
    expect(stateService.appendAssistantMessage).toHaveBeenCalledWith(
      'user-1234567890',
      'Não consegui salvar essa meta agora. Quer que eu tente de novo com você?',
    );
    expect(stateService.appendAssistantMessage).not.toHaveBeenCalledWith(
      'user-1234567890',
      'Meta criada com sucesso!',
    );
    expect(stateService.resetFlow).toHaveBeenCalledWith('user-1234567890');
  });

  it('detecta e rejeita alteração suspeita de schedule (remover dia de semana)', async () => {
    const llm = {
      analyze: jest.fn().mockResolvedValue({
        classification: CLASSIFICATIONS.CONTINUE,
        confidence: 0.95,
        extracted: {
          payload: {
            title: 'Estudar',
            goalType: 'Continua',
            conquestType: 'Mente',
            reminderTime: '16:40',
            scheduleConfig: {
              type: 'weekly',
              daysOfWeek: [2, 3, 4, 5], // removeu segunda-feira (1)
              times: ['16:40'],
            },
          },
        },
        suggestedReply: 'Ok, ajustado!',
        finished: true,
      }),
    };
    const comm = {
      generateProgressMetadata: jest.fn(),
    };

    const nucleus = new GoalCreationNucleus(llm as any, comm as any);
    const result = await nucleus.analyze({
      userId: 'user-1234567890',
      currentSession: FLOW_STATES.GOAL_CREATION,
      text: 'Não me lembre de estudar no dia de hoje',
      meta: {
        title: 'Estudar',
        goalId: 'goal-estudar',
        scheduleConfig: {
          type: 'weekly',
          daysOfWeek: [1, 2, 3, 4, 5], // originalmente seg-sex
          times: ['16:40'],
        },
      },
    });

    expect(result.decision).toBe('handled');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      type: 'continue',
      to: FLOW_STATES.GOAL_CREATION,
    });
    // Deve sugerir pausar em vez de remover permanentemente
    expect(result.actions[1].type).toBe('reply');
    const replyText = (result.actions[1] as any).text;
    expect(replyText).toContain('pausar');
    // Deve marcar no continue payload que foi detectada redução suspeita
    const continueAction = result.actions[0] as any;
    expect(continueAction.payload.suspiciousScheduleReductionDetected).toBe(true);
  });

  it('executa dismiss_goal_for_today quando usuário confirma pausar lembrete', async () => {
    const llm = {
      analyze: jest.fn().mockResolvedValue({
        classification: CLASSIFICATIONS.CONTINUE,
        confidence: 0.99,
        extracted: {
          payload: {
            title: 'Estudar',
            goalType: 'Continua',
            conquestType: 'Mente',
          },
        },
        suggestedReply: 'Confirma pausar?',
        finished: true,
      }),
    };
    const comm = {
      generateProgressMetadata: jest.fn(),
    };

    const nucleus = new GoalCreationNucleus(llm as any, comm as any);
    const result = await nucleus.analyze({
      userId: 'user-1234567890',
      currentSession: FLOW_STATES.GOAL_CREATION,
      text: 'Sim, pausar',
      meta: {
        title: 'Estudar',
        goalId: 'goal-estudar',
        timezone: 'America/Sao_Paulo',
        suspiciousScheduleReductionDetected: true, // marcado na turno anterior
      },
    });

    expect(result.decision).toBe('handled');
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        type: 'dismiss_goal_for_today',
        payload: expect.objectContaining({
          goalId: 'goal-estudar',
        }),
      }),
    );
    // Deve ter reply de confirmação
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        type: 'reply',
      }),
    );
  });
});

