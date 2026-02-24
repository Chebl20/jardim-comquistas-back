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
    const payloadForLLM = {
      ...meta,
      recentMessages: Array.isArray(meta.recentMessages)
        ? meta.recentMessages
        : [],
    };

    const systemPromptWithContext = `${GOAL_PROMPT}
    
Estado atual da máquina: ${input.currentSession || 'IDLE'}
Payload atual: ${JSON.stringify(payloadForLLM)}`;

    const llmRes = await this.llm.analyze(
      {
        currentState: input.currentSession || 'IDLE',
        payload: payloadForLLM,
        userMessage: text,
      },
      systemPromptWithContext,
    );

    const { classification, finished, extracted, suggestedReply } = llmRes;

    const payload = extracted?.payload || {};

    // 🟡 REGRA PURA

    if (classification === 'cancel') {
      return {
        actions: [
          { type: 'cancel' },
          { type: 'reply', text: suggestedReply },
        ],
        nucleus: 'goal-creation',
      };
    }

    if (finished === true) {
      return {
        actions: [
          { type: 'create_goal', payload },
          { type: 'reply', text: suggestedReply },
        ],
        nucleus: 'goal-creation',
      };
    }

    // default → continue
    return {
      actions: [
        { type: 'continue', payload },
        { type: 'reply', text: suggestedReply },
      ],
      nucleus: 'goal-creation',
    };

  } catch (e) {
    this.logger.warn('GoalCreation LLM failed', e);

    return {
      actions: [
        {
          type: 'reply',
          text: 'Tive dificuldade para interpretar sua meta. Pode reformular em uma frase simples?',
        },
      ],
      nucleus: 'goal-creation',
    };
  }
}

}

export default GoalCreationNucleus;