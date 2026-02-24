import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput } from '../nuclei/nucleus.interface';
import { ClarificationNucleus } from '../nuclei/clarification';
import { GoalCreationNucleus } from '../nuclei/goal-creation';
import { ConversationSessionService } from '../../shared/conversation-session.service';
import { prisma } from '../../../prisma/client';
import { UserGoalService } from '../../goals/user-goal.service';
import { FlowResult, Action, FlowState } from './flow.types';

@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);

  private flows: Record<FlowState, any>;

  constructor(
    private clarification: ClarificationNucleus,
    private goalCreation: GoalCreationNucleus,
    private sessionService: ConversationSessionService,
    private userGoalService: UserGoalService,
  ) {
    this.flows = {
      IDLE: this.clarification,
      CLARIFICATION: this.clarification,
      GOAL_CREATION: this.goalCreation,
    };
  }

  private async applyAction(
    userId: string,
    action: Action,
    worldId: string,
  ): Promise<{ redirectedTo?: FlowState }> {
    switch (action.type) {
      case 'continue': {
        const sess = await this.sessionService.getSession(userId);
        const base =
          sess?.payload && typeof sess.payload === 'object' ? sess.payload : {};

        await this.sessionService.updateSession(userId, {
          state: sess?.state ?? 'IDLE',
          payload: { ...base, ...(action.payload || {}) },
        });

        return { redirectedTo: undefined };
      }

      case 'redirect':
        await this.sessionService.updateSession(userId, {
          state: action.to,
          payload: action.payload ?? {},
        });

        return { redirectedTo: action.to };

      case 'create_goal':
        await this.userGoalService.createUserGoalWithTree({
          ...(action.payload as any),
          userId,
          worldId,
        } as any);

        await this.sessionService.updateSession(userId, {
          state: 'IDLE',
          payload: {},
        });

        return { redirectedTo: 'IDLE' };

      case 'cancel':
        await this.sessionService.updateSession(userId, {
          state: 'IDLE',
          payload: {},
        });

        return { redirectedTo: 'IDLE' };

      case 'reply':
        // reply é tratado fora (apenas agregação)
        return { redirectedTo: undefined };
    }
  }

  private async execActionsSequentially(
    userId: string,
    actions: Action[],
    worldId: string,
  ): Promise<{ reply: string; redirectedTo?: FlowState }> {
    let reply = '';
    let redirectedTo: FlowState | undefined = undefined;

    for (const action of actions) {
      if (action.type === 'reply') {
        reply = action.text ?? reply;
        continue;
      }

      const res = await this.applyAction(userId, action, worldId);

      if (res?.redirectedTo) {
        redirectedTo = res.redirectedTo;
      }
    }

    return { reply, redirectedTo };
  }

  async handle(opts: any) {
    try {
      const userId = String(opts.userId || '');
      const initialSession = await this.sessionService.getSession(userId);
      const initialState = (initialSession?.state ?? 'IDLE') as FlowState;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      const worldId = user?.currentWorldId || 'mundo1';

      let currentState = initialState;
      let finalReply = '';

      const maxIterations = 3;
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        // 🔄 Sempre recarrega sessão
        const freshSession = await this.sessionService.getSession(userId);
        const freshPayload =
          freshSession?.payload && typeof freshSession.payload === 'object'
            ? freshSession.payload
            : {};

        const nucleus = this.flows[currentState] ?? this.clarification;

        const input: NucleusInput = {
          userId,
          currentSession: currentState,
          text: String(opts.userMessage || opts.text || ''),
          meta: {
            ...freshPayload,
            user: {
              id: userId,
              name: user?.name,
              timezone: user?.timezone,
            },
            worldId,
            serverTime: new Date().toISOString(),
          },
        };

        const result: FlowResult = await nucleus.analyze(input);

        // 🔴 CONTRATO OBRIGATÓRIO
        if (!Array.isArray(result?.actions)) {
          this.logger.error('Invalid FlowResult: actions[] missing', result);

          return {
            kind: 'direct',
            reply: 'Erro interno de fluxo. Pode repetir?',
            origin: 'orchestrator',
          };
        }

        const { reply, redirectedTo } = await this.execActionsSequentially(
          userId,
          result.actions,
          worldId,
        );

        if (reply) {
          finalReply = reply;
        }

        // 🔁 Redirect no mesmo request
        if (redirectedTo && redirectedTo !== currentState) {
          currentState = redirectedTo;
          continue;
        }

        // ✅ Sem redirect → encerra
        return {
          kind: 'direct',
          reply: finalReply || '',
          origin: result.nucleus,
        };
      }

      // 🚨 Proteção contra loop infinito
      return {
        kind: 'direct',
        reply: finalReply || 'Fluxo interrompido (excesso de redirecionamentos).',
        origin: 'orchestrator',
      };
    } catch (e) {
      this.logger.error('Orchestrator failed', e);

      return {
        kind: 'direct',
        reply: 'Algo deu errado. Pode repetir?',
        origin: 'orchestrator',
      };
    }
  }

  async analyze(opts: any) {
    return this.handle(opts);
  }
}

export default ConversationOrchestratorService;
