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

  private async applyAction(userId: string, action: Action, worldId: string) {
    switch (action.type) {
      case 'continue': {
        const sess = await this.sessionService.getSession(userId);
        const base = sess?.payload && typeof sess.payload === 'object' ? sess.payload : {};
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
        await this.sessionService.updateSession(userId, { state: 'IDLE', payload: {} });
        return { redirectedTo: 'IDLE' };
      case 'cancel':
        await this.sessionService.updateSession(userId, { state: 'IDLE', payload: {} });
        return { redirectedTo: 'IDLE' };
      case 'reply':
        // reply tratado no agregador (no-op aqui)
        return { redirectedTo: undefined };
    }
  }

  private async execActionsSequentially(userId: string, actions: Action[] = [], worldId: string) {
    let reply = '';
    let redirectedTo: FlowState | undefined = undefined;
    for (const a of actions) {
      if (a.type === 'reply') {
        reply = a.text ?? reply;
      } else {
        const res: any = await this.applyAction(userId, a, worldId);
        if (res && res.redirectedTo) redirectedTo = res.redirectedTo;
      }
    }
    return { reply, redirectedTo };
  }

  async handle(opts: any) {
    try {
      const userId = String(opts.userId || '');
      const session = await this.sessionService.getSession(userId);
      const state = (session?.state ?? 'IDLE') as FlowState;

      const basePayload =
        session?.payload && typeof session.payload === 'object'
          ? session.payload
          : {};

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const worldId = user?.currentWorldId || 'mundo1';

      const input: NucleusInput = {
        userId,
        currentSession: state,
        text: String(opts.userMessage || opts.text || ''),
        meta: {
          ...basePayload,
          user: { id: userId, name: user?.name, timezone: user?.timezone },
          worldId,
          serverTime: new Date().toISOString(),
        },
      };

      // Controlled loop to allow immediate re-execution after redirect actions.
      let currentState = state as FlowState;
      let finalReply = '';
      const maxIterations = 3;
      let iter = 0;

      while (iter < maxIterations) {
        iter += 1;
        const nucleus = this.flows[currentState] ?? this.clarification;
        this.logger.debug(`Orchestrator loop ${iter}: user=${userId} state=${currentState} nucleus=${nucleus?.constructor?.name || nucleus?.name || 'unknown'}`);

        // reload fresh session and rebuild input so each iteration sees updated session.payload
        const freshSession = await this.sessionService.getSession(userId);
        const freshPayload = freshSession?.payload && typeof freshSession.payload === 'object' ? freshSession.payload : {};
        // NOTE: do not refetch user inside the loop; user record unlikely to change
        // during a single request. Use the previously fetched `worldId` for actions.
        const worldIdNow = worldId;

        const iterInput: NucleusInput = {
          userId,
          currentSession: currentState,
          text: String(opts.userMessage || opts.text || ''),
          meta: {
            ...freshPayload,
            user: { id: userId, name: user?.name, timezone: user?.timezone },
            worldId: worldIdNow,
            serverTime: new Date().toISOString(),
          },
        };

        const result: FlowResult = await nucleus.analyze(iterInput);

        // Only accept the canonical actions[] contract.
        if (!Array.isArray(result?.actions)) {
          // If nucleus fails to return actions, fall back to suggestedReply in a deterministic way.
          finalReply = String(result?.suggestedReply || '');
          return { kind: 'direct', say: finalReply, origin: (result as any)?.nucleus };
        }

            const { reply, redirectedTo } = await this.execActionsSequentially(userId, result.actions || [], worldIdNow) as any;

        if (reply) finalReply = reply;

        if (redirectedTo && redirectedTo !== currentState) {
          // prepare to execute the target nucleus in the same call
          currentState = redirectedTo as FlowState;
          // continue loop to execute new nucleus
          continue;
        }

        // no redirect → end loop and return final reply
        return { kind: 'direct', say: finalReply || result.suggestedReply || '', origin: (result as any)?.nucleus };
      }

      // exceeded max iterations
      return { kind: 'direct', say: finalReply || 'Fluxo interrompido (muito redirecionamentos).', origin: 'orchestrator' };
    } catch (e) {
      this.logger.warn('Orchestrator failed', e);
      return { kind: 'direct', say: 'Algo deu errado. Pode repetir?', origin: 'orchestrator' };
    }
  }
  

  async analyze(opts: any) {
    return this.handle(opts);
  }
}

export default ConversationOrchestratorService;