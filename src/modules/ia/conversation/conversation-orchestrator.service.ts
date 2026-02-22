import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput } from '../nuclei/nucleus.interface';
import { ClarificationNucleus } from '../nuclei/clarification';
import { GoalCreationNucleus } from '../nuclei/goal-creation';
import { ConversationSessionService } from '../../shared/conversation-session.service';
import { prisma } from '../../../prisma/client';
import { UserGoalService } from '../../goals/user-goal.service';

@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);

  constructor(
    private clarification: ClarificationNucleus,
    private goalCreation: GoalCreationNucleus,
    private sessionService: ConversationSessionService,
    private userGoalService: UserGoalService,
  ) {}

  private async transition(
    userId: string,
    from: string,
    to: string,
    reason: string,
    payload: any,
  ) {
    if (from !== to) {
      this.logger.warn(`[STATE TRANSITION] ${from} → ${to} | ${reason}`);
    }

    await this.sessionService.updateSession(userId, {
      state: to,
      payload,
    });
  }

  async handle(opts: any) {
    try {
      const userId = String(opts.userId || '');
      const session = await this.sessionService.getSession(userId);
      const state = session?.state || 'IDLE';

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

      // ===============================
      // STATE: IDLE
      // ===============================
      if (state === 'IDLE') {
        const goalRes: any = await this.goalCreation.analyze(input);

        const shouldEnterGoalCreation =
          goalRes?.action === 'CREATE_GOAL' &&
          goalRes?.confidence > 0.6 &&
          !goalRes?.delegate;

        if (shouldEnterGoalCreation) {
          await this.transition(
            userId,
            'IDLE',
            'GOAL_CREATION',
            'User initiated goal creation',
            basePayload,
          );

          return this.processGoalCreation(userId, input, basePayload, worldId);
        }

        const clar = await this.clarification.analyze(input);

        return {
          kind: 'direct',
          say: clar?.suggestedReply,
          origin: clar?.nucleus,
        };
      }

      // ===============================
      // STATE: GOAL_CREATION
      // ===============================
      if (state === 'GOAL_CREATION') {
        return this.processGoalCreation(userId, input, basePayload, worldId);
      }

      // ===============================
      // STATE: CLARIFICATION
      // ===============================
      if (state === 'CLARIFICATION') {
        const clarRes: any = await this.clarification.analyze(input);

        if (clarRes?.intent === 'CREATE_GOAL') {
          await this.transition(
            userId,
            'CLARIFICATION',
            'GOAL_CREATION',
            'User switched to goal creation',
            basePayload,
          );

          return this.processGoalCreation(userId, input, basePayload, worldId);
        }

        return {
          kind: 'direct',
          say: clarRes?.suggestedReply,
          origin: clarRes?.nucleus,
        };
      }

      // ===============================
      // FALLBACK GLOBAL
      // ===============================
      await this.transition(
        userId,
        state,
        'CLARIFICATION',
        'Fallback',
        basePayload,
      );

      const clar = await this.clarification.analyze(input);

      return {
        kind: 'direct',
        say: clar?.suggestedReply,
        origin: clar?.nucleus,
      };
    } catch (e) {
      this.logger.warn('Orchestrator failed', e);
      return {
        kind: 'direct',
        say: 'Algo deu errado. Pode repetir?',
        origin: 'orchestrator',
      };
    }
  }

  private async processGoalCreation(
    userId: string,
    input: NucleusInput,
    basePayload: any,
    worldId: string,
  ) {
    const goalRes: any = await this.goalCreation.analyze({
      ...input,
      currentSession: 'GOAL_CREATION',
    });

    // ===============================
    // CANCELAMENTO
    // ===============================
    if (goalRes?.cancelled) {
      await this.transition(
        userId,
        'GOAL_CREATION',
        'IDLE',
        'User cancelled goal creation',
        {},
      );

      return {
        kind: 'direct',
        say: goalRes?.suggestedReply || 'Criação cancelada.',
        origin: goalRes?.nucleus,
      };
    }

    // ===============================
    // DELEGATE PARA CLARIFICATION
    // ===============================
    if (goalRes?.delegate === 'clarification') {
      await this.transition(
        userId,
        'GOAL_CREATION',
        'CLARIFICATION',
        'Delegated by goal nucleus',
        basePayload,
      );

      const clar = await this.clarification.analyze(input);

      return {
        kind: 'direct',
        say: clar?.suggestedReply,
        origin: clar?.nucleus,
      };
    }

    const payloadFromNucleus = goalRes?.extracted?.payload || {};
    const missing = goalRes?.extracted?.missing || [];

    const mergedPayload = {
      ...basePayload,
      ...payloadFromNucleus,
    };

    // ===============================
    // CAMPOS FALTANDO
    // ===============================
    if (missing.length > 0) {
      await this.transition(
        userId,
        'GOAL_CREATION',
        'GOAL_CREATION',
        'Missing fields',
        mergedPayload,
      );

      return {
        kind: 'direct',
        say: goalRes?.suggestedReply,
        origin: goalRes?.nucleus,
      };
    }

    // ===============================
    // META COMPLETA E CONFIRMADA
    // ===============================
    if (goalRes?.finished) {
      await this.userGoalService.createUserGoalWithTree({
        ...mergedPayload,
        userId,
        worldId,
      });

      await this.transition(
        userId,
        'GOAL_CREATION',
        'IDLE',
        'Goal created',
        {},
      );

      return {
        kind: 'direct',
        say: goalRes?.suggestedReply,
        origin: goalRes?.nucleus,
        action: {
          intent: 'CREATE_GOAL',
          data: { ...mergedPayload, worldId },
        },
      };
    }

    // ===============================
    // CONTINUA COLETA
    // ===============================
    await this.transition(
      userId,
      'GOAL_CREATION',
      'GOAL_CREATION',
      'Continue goal creation',
      mergedPayload,
    );

    return {
      kind: 'direct',
      say: goalRes?.suggestedReply,
      origin: goalRes?.nucleus,
    };
  }

  async analyze(opts: any) {
    return this.handle(opts);
  }
}

export default ConversationOrchestratorService;