import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput } from '../nucleus.interface';
import { FlowResult } from '../../conversation/flow.types';
import { GOAL_CREATION_PROMPT as GOAL_PROMPT } from './prompt';
import { ConversationAIService } from '../../conversation-ai.service';

export interface GoalPayload {
  title?: string;
  description?: string | null;
  goalType?: 'Pontual' | 'Continua' | null;
  conquestType?: 'Corpo' | 'Mente' | 'Familia' | 'Trabalho' | 'Social' | 'Financeiro' | 'Espiritual' | 'Hobby_Lazer' | null;
  frequency?: number | null;
  reminderTime?: string | null; // ISO UTC
  timeToken?: string | null; // relative token
}

@Injectable()
export class GoalCreationNucleus {
  public static PROMPT = GOAL_PROMPT;
  private readonly logger = new Logger(GoalCreationNucleus.name);
  extracted: any;

  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<FlowResult> {
    const text = (input.text || '').trim();
    const meta = input.meta || {};

    try {
      // -----------------------------
      // Prepara payload completo para o LLM, incluindo recentMessages
      // -----------------------------
      const payloadForLLM = {
        ...meta,
        recentMessages: Array.isArray(meta.recentMessages) ? meta.recentMessages : [],
      };

      // -----------------------------
      // LOG detalhado para debug
      // -----------------------------
      try {
        const recentMsgs = payloadForLLM.recentMessages.map((m: any, i: number) => ({
          index: i,
          role: m?.role || 'unknown',
          text: String(m?.text || '').slice(0, 200),
        }));
        this.logger.debug(
          'GoalCreationNucleus - input para LLM:\n' +
          JSON.stringify({
            currentState: input.currentSession || 'IDLE',
            payloadKeys: Object.keys(payloadForLLM),
            recentMessages: recentMsgs,
            userMessage: text,
          }, null, 2)
        );
      } catch (err) {
        this.logger.warn('Falha ao gerar log detalhado das mensagens recentes', err);
      }

      const systemPromptWithContext = `${GOAL_PROMPT}\n\nEstado atual da máquina: ${input.currentSession || 'IDLE'}\nPayload atual: ${JSON.stringify(payloadForLLM)}`;

      const llmRes = await this.llm.analyze(
        { currentState: input.currentSession || 'IDLE', payload: payloadForLLM, userMessage: text },
        systemPromptWithContext
      );

      // Normalize model output into a strict contract
      // Freeze contract: only `classification` is accepted (no fallback to `type`).
      if (typeof llmRes?.type !== 'undefined') {
        this.logger.warn('GoalCreationNucleus: model returned `type` field — ignoring `type`, expect `classification`.');
      }

      const modelOut = {
        classification: typeof llmRes?.classification === 'string' ? llmRes.classification : undefined,
        action: llmRes?.action || undefined,
        finished: Boolean(llmRes?.finished === true),
        extracted: llmRes?.extracted || { payload: {}, missing: [] },
        suggestedReply: String(llmRes?.suggestedReply || ''),
        confidence: Number(llmRes?.confidence ?? 0.5),
      } as const;

      // Validate contract minimally — if model didn't return expected shape, fallback to safe reply
      if (!modelOut.extracted || typeof modelOut.suggestedReply !== 'string') {
        this.logger.warn('GoalCreationNucleus: model returned unexpected format', llmRes);
        return { actions: [{ type: 'reply', text: 'Não entendi bem — pode repetir ou reformular a meta?' }], nucleus: 'goal-creation' } as FlowResult;
      }

      // Delegar small talk (model says so)
      if (modelOut.classification === 'small_talk') {
        return { actions: [{ type: 'reply', text: modelOut.suggestedReply || 'Posso ajudar em outra coisa?' }], nucleus: 'goal-creation' } as FlowResult;
      }

      // If model indicates a new intent that is not CREATE_GOAL, redirect to clarification without producing a reply
      if (modelOut.classification === 'new_intent' && modelOut.action !== 'CREATE_GOAL') {
        return { actions: [{ type: 'redirect', to: 'CLARIFICATION', payload: modelOut.extracted.payload || {} }], nucleus: 'goal-creation' } as FlowResult;
      }

      // Cancel intent
      if (modelOut.action === 'CANCEL' || modelOut.classification === 'cancel') {
        return { actions: [{ type: 'cancel' }, { type: 'reply', text: modelOut.suggestedReply || 'Tudo bem — cancelado.' }], nucleus: 'goal-creation' } as FlowResult;
      }

      const payload = modelOut.extracted.payload || {};

      // If finished -> persist
      if (modelOut.finished) {
        return { actions: [{ type: 'create_goal', payload }, { type: 'reply', text: modelOut.suggestedReply || 'Meta criada.' }], nucleus: 'goal-creation' } as FlowResult;
      }

      // Otherwise continue the flow with merged payload and the model's suggestedReply
      return { actions: [{ type: 'continue', payload }, { type: 'reply', text: modelOut.suggestedReply }], nucleus: 'goal-creation' } as FlowResult;

    } catch (e) {
      this.logger.warn('GoalCreation LLM failed', e);
      return { actions: [{ type: 'reply', text: 'Não entendi bem — pode informar o título e horário da meta?' }], nucleus: 'goal-creation' } as FlowResult;
    }
  }

}

export default GoalCreationNucleus;