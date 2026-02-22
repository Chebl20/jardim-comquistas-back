import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, NucleusResult } from '../nucleus.interface';
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

  async analyze(input: NucleusInput): Promise<NucleusResult> {
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

const base: any = {
  confidence: llmRes.confidence || 0.5,
  suggestedReply: String(llmRes.suggestedReply || ''),
  extracted: llmRes.extracted || { payload: {}, missing: [] },
  action: llmRes?.action === 'CREATE_GOAL' ? 'CREATE_GOAL' : undefined,
  nucleus: 'goal-creation',
};

      // Delegar apenas se for claramente fora do escopo
      if (llmRes?.type === 'small_talk' || llmRes?.classification === 'small_talk') {
        return { ...base, delegate: 'clarification' } as NucleusResult;
      }

      // Se for new_intent mas continuar sendo CREATE_GOAL, NÃO delega.
      if (llmRes?.type === 'new_intent' && llmRes?.action !== 'CREATE_GOAL') {
        return { ...base, delegate: 'clarification' } as NucleusResult;
      }

      if (llmRes && llmRes.type === 'cancel') {
  this.logger.debug(`GoalCreationNucleus: cancel detected`);

  return {
    ...base,
    finished: false,          // ❌ NÃO finaliza meta
    cancelled: true,          // ✅ flag nova
    suggestedReply: 'Tudo bem! Cancelamos a criação da meta 😊',
  } as NucleusResult;
}

      // Extrai payload e campos missing
      const extracted: any = llmRes.extracted || {};
      const payload: GoalPayload = extracted.payload || {};
      const missing: string[] = [];
      if (!payload.title) missing.push('title');
      if (!payload.reminderTime && !payload.timeToken) missing.push('reminderTime');

      base.extracted = { payload, missing };
      const payloadCompleto = missing.length === 0;

      // ----------------------------
      // Confirmação com usuário
      // ----------------------------
      if (payloadCompleto) {
        const userConfirmed = ['sim', 'ok', 'confirmar', 'confirma'].some(word =>
          text.toLowerCase().includes(word)
        );

        if (!userConfirmed) {
          base.suggestedReply = `Você quer criar a meta "${payload.title}"${
            payload.frequency ? `, todos os dias às ${new Date(payload.reminderTime!).toLocaleTimeString()}` : ''
          } como ${payload.conquestType}?`;
          base.finished = false;
          return base as NucleusResult;
        } else {
          base.finished = true;
          base.suggestedReply = `Meta "${payload.title}" criada com sucesso!`;
          return base as NucleusResult;
        }
      }

      if (missing.length > 0) {
        base.finished = false;
        base.suggestedReply =
          llmRes.suggestedReply || `Ainda preciso de mais informações para criar a meta: ${missing.join(', ')}`;
        return base as NucleusResult;
      }

      return base as NucleusResult;

    } catch (e) {
      this.logger.warn('GoalCreation LLM failed', e);
      return {
        confidence: 0.3,
        suggestedReply: 'Não entendi bem — pode informar o título e horário da meta?',
        extracted: { payload: {}, missing: ['title', 'reminderTime'] },
        action: 'CREATE_GOAL',
        finished: false,
        nucleus: 'goal-creation',
      } as NucleusResult;
    }
  }

}

export default GoalCreationNucleus;