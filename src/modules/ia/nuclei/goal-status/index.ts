import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus } from '../nucleus.interface';
import {
  FlowResult,
  FLOW_STATES,
  DECISIONS,
  CLASSIFICATIONS,
} from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { GOAL_STATUS_PROMPT } from './prompt';

@Injectable()
export class GoalStatusNucleus implements Nucleus {
  public static PROMPT = GOAL_STATUS_PROMPT;
  private readonly logger = new Logger(GoalStatusNucleus.name);

  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<FlowResult> {
    const systemPrompt = GOAL_STATUS_PROMPT(
      input.currentSession || FLOW_STATES.CLARIFICATION,
      input.meta || {},
    );
    try {
      const uGoals = (input.meta && (input.meta as any).userGoalsSummary) || [];
      const count = Array.isArray(uGoals) ? uGoals.length : 0;
      this.logger.debug(`GoalStatus incoming userGoalsSummary count=${count}`);
      if (count > 0) {
        const summary = (uGoals as any[]).map((g: any) => ({
          title: g.title,
          type: g.type,
          conquestType: g.conquestType,
          completed: g.completed,
          reminderTime: g.reminderTime,
          frequency: g.frequency,
        }));
        this.logger.debug(
          `GoalStatus userGoalsSummary data: ${JSON.stringify(summary)}`,
        );
      }
    } catch (_) {}

    try {
      const aiRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: input.meta || {},
          userMessage: input.text || '',
        },
        systemPrompt,
      );

      const { classification, suggestedReply, confidence } = aiRes;

      // Derivar decisão a partir da classificação (contrato padrão dos núcleos)
      if (classification === CLASSIFICATIONS.NEW_INTENT) {
        // Extrair metadata da meta mencionada se possível
        // Isso ajuda o Router a passar contexto para o próximo núcleo (ex: REMINDER)
        let extractedPayload: Record<string, any> = {};

        if (input.text && input.meta?.userGoalsSummary) {
          const userGoals = (input.meta.userGoalsSummary as any[]) || [];
          const textLower = input.text.toLowerCase();

          // Tentar encontrar a meta mencionada pelo usuário
          const mentionedGoal = userGoals.find((g) =>
            textLower.includes((g.title || '').toLowerCase()),
          );

          if (mentionedGoal) {
            // Passar informações da meta para o próximo núcleo
            extractedPayload = {
              goalId: mentionedGoal.id,
              goalTitle: mentionedGoal.title,
              goalDescription: mentionedGoal.description || '',
              goalType: mentionedGoal.type,
              conquestType: mentionedGoal.conquestType,
            };
            this.logger.debug(
              `GoalStatus extracted meta: ${mentionedGoal.title} (id: ${mentionedGoal.id})`,
            );
          }
        }

        return {
          actions: [],
          decision: DECISIONS.NOT_MY_JOB,
          confidence,
          extracted: { payload: extractedPayload },
        };
      }

      if (classification === CLASSIFICATIONS.UNCERTAIN) {
        const replyAction = suggestedReply
          ? [{ type: 'reply' as const, text: suggestedReply }]
          : [];
        return {
          actions: replyAction,
          decision: DECISIONS.UNCERTAIN,
          confidence,
        };
      }

      // continue ou qualquer outro valor → HANDLED
      // Emitir `continue` para manter sessão em GOAL_STATUS e evitar re-routing em follow-ups
      const actions: Array<{ type: string; text?: string; to?: string }> = [
        { type: 'continue', to: FLOW_STATES.GOAL_STATUS },
      ];
      if (suggestedReply) {
        actions.push({ type: 'reply', text: suggestedReply });
      }
      return {
        actions: actions as any,
        decision: DECISIONS.HANDLED,
        confidence,
      };
    } catch (e) {
      this.logger.warn('GoalStatus LLM failed', e);
      return {
        actions: [
          {
            type: 'reply',
            text: 'Desculpa, não consegui verificar suas metas agora.',
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }
}
