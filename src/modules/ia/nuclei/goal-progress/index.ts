import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus } from '../nucleus.interface';
import {
  FlowResult,
  Action,
  FLOW_STATES,
  DECISIONS,
} from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { GOAL_PROGRESS_PROMPT, GOAL_PROGRESS_CLASSIFICATIONS } from './prompt';

export interface GoalProgressMeta {
  userGoalsSummary?: Array<{
    id: string;
    title: string;
    type?: string;
    goalType?: string;
  }>;
  candidates?: Array<{ id: string; title: string }>;
  pendingGoalId?: string;
  pendingGoalTitle?: string;
  pendingGoalType?: string;
  /** Mensagem do usuário que disparou o single_match (para descrição do GrowthEvent) */
  pendingUserMessage?: string;
  recentMessages?: Array<{ role: string; text: string }>;
}

@Injectable()
export class GoalProgressNucleus implements Nucleus<Action> {
  private readonly logger = new Logger(GoalProgressNucleus.name);

  constructor(private readonly llm: ConversationAIService) {}

  async analyze(
    input: NucleusInput<GoalProgressMeta>,
  ): Promise<FlowResult<Action>> {
    const text = (input.text || '').trim();
    const meta = input.meta || {};

    try {
      const prompt = GOAL_PROGRESS_PROMPT(
        input.currentSession || FLOW_STATES.GOAL_PROGRESS,
        meta,
      );

      const llmRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.GOAL_PROGRESS,
          payload: meta,
          userMessage: text,
        },
        prompt,
      );

      const classification = llmRes.classification || '';
      const suggestedReply = llmRes.suggestedReply || '';
      const confidence =
        typeof llmRes.confidence === 'number' ? llmRes.confidence : 0.5;

      const payload = llmRes.extracted?.payload || {};
      const matchedGoalId =
        typeof payload.matchedGoalId === 'string'
          ? payload.matchedGoalId
          : undefined;
      const matchedGoalTitle =
        typeof payload.matchedGoalTitle === 'string'
          ? payload.matchedGoalTitle
          : '';
      const matchedGoalType =
        payload.matchedGoalType === 'Pontual' ||
        payload.matchedGoalType === 'Continua'
          ? payload.matchedGoalType
          : 'Continua';
      const candidates = Array.isArray(payload.candidates)
        ? payload.candidates
        : undefined;

      if (classification === GOAL_PROGRESS_CLASSIFICATIONS.NEW_INTENT) {
        return {
          actions: [],
          decision: DECISIONS.NOT_MY_JOB,
          confidence,
        };
      }

      if (classification === GOAL_PROGRESS_CLASSIFICATIONS.UNCERTAIN) {
        const replyAction = suggestedReply
          ? [{ type: 'reply' as const, text: suggestedReply }]
          : [];
        return {
          actions: replyAction,
          decision: DECISIONS.UNCERTAIN,
          confidence,
        };
      }

      const actions: Action[] = [];

      if (
        classification === GOAL_PROGRESS_CLASSIFICATIONS.SINGLE_MATCH &&
        matchedGoalId
      ) {
        if (suggestedReply) {
          actions.push({ type: 'reply', text: suggestedReply });
        }
        actions.push({
          type: 'continue',
          payload: {
            pendingGoalId: matchedGoalId,
            pendingGoalTitle: matchedGoalTitle || undefined,
            pendingGoalType: matchedGoalType,
            pendingUserMessage: text,
          },
          to: FLOW_STATES.GOAL_PROGRESS,
        });
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence,
        };
      }

      if (
        classification ===
          GOAL_PROGRESS_CLASSIFICATIONS.CONFIRMATION_RESPONSE &&
        meta.pendingGoalId
      ) {
        const confirmed = payload.confirmed === true;
        if (confirmed) {
          if (suggestedReply) {
            actions.push({ type: 'reply', text: suggestedReply });
          }
          actions.push({
            type: 'mark_done',
            payload: {
              goalId: meta.pendingGoalId,
              goalTitle: meta.pendingGoalTitle || undefined,
              goalType:
                meta.pendingGoalType === 'Pontual' ||
                meta.pendingGoalType === 'Continua'
                  ? meta.pendingGoalType
                  : 'Continua',
              userMessage: meta.pendingUserMessage || undefined,
            },
          });
          actions.push({
            type: 'redirect',
            to: FLOW_STATES.CLARIFICATION,
            payload: {
              pendingGoalId: undefined,
              pendingGoalTitle: undefined,
              pendingGoalType: undefined,
              pendingUserMessage: undefined,
              recentEvent: 'goal_completed',
            },
          });
        } else {
          const cancelReply = suggestedReply || 'Tudo bem, não vou marcar.';
          actions.push({ type: 'reply', text: cancelReply });
          actions.push({
            type: 'redirect',
            to: FLOW_STATES.CLARIFICATION,
            payload: {
              pendingGoalId: undefined,
              pendingGoalTitle: undefined,
              pendingGoalType: undefined,
            },
          });
        }
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence,
        };
      }

      if (
        classification ===
          GOAL_PROGRESS_CLASSIFICATIONS.DISAMBIGUATION_RESPONSE &&
        matchedGoalId &&
        meta.candidates?.length
      ) {
        if (suggestedReply) {
          actions.push({ type: 'reply', text: suggestedReply });
        }
        actions.push({
          type: 'mark_done',
          payload: {
            goalId: matchedGoalId,
            goalTitle: matchedGoalTitle || undefined,
            goalType: matchedGoalType,
            userMessage: meta.pendingUserMessage || undefined,
          },
        });
        actions.push({
          type: 'redirect',
          to: FLOW_STATES.CLARIFICATION,
          payload: {
            candidates: undefined,
            pendingUserMessage: undefined,
            recentEvent: 'goal_completed',
          },
        });
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence,
        };
      }

      if (
        classification === GOAL_PROGRESS_CLASSIFICATIONS.MULTIPLE_MATCH &&
        candidates?.length
      ) {
        if (suggestedReply) {
          actions.push({ type: 'reply', text: suggestedReply });
        }
        actions.push({
          type: 'continue',
          payload: { candidates, pendingUserMessage: text },
          to: FLOW_STATES.GOAL_PROGRESS,
        });
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence,
        };
      }

      if (classification === GOAL_PROGRESS_CLASSIFICATIONS.NO_MATCH) {
        if (suggestedReply) {
          actions.push({ type: 'reply', text: suggestedReply });
        }
        actions.push({
          type: 'redirect',
          to: FLOW_STATES.CLARIFICATION,
          payload: {},
        });
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence,
        };
      }

      this.logger.warn(
        `GoalProgress: unhandled classification=${classification}`,
      );
      return {
        actions: suggestedReply
          ? [{ type: 'reply', text: suggestedReply }]
          : [],
        decision: DECISIONS.HANDLED,
        confidence,
      };
    } catch (e) {
      this.logger.warn('GoalProgress LLM failed', e);
      return {
        actions: [
          {
            type: 'reply',
            text: 'Desculpa, não consegui registrar seu progresso agora. Tente de novo.',
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }
}

export default GoalProgressNucleus;
