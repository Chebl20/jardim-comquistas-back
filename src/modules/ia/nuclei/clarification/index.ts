import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput } from '../nucleus.interface';
import { FlowResult } from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { PROMPT as CLARIFICATION_PROMPT } from '../clarification/prompt';

@Injectable()
export class ClarificationNucleus {
  private readonly logger = new Logger(ClarificationNucleus.name);
  public static PROMPT = CLARIFICATION_PROMPT;
  constructor(private readonly llm: ConversationAIService) {}

async analyze(input: NucleusInput): Promise<FlowResult> {
  const text = (input.text || '').trim();
  const meta = input.meta || {};

  try {
    const systemPromptWithContext = `${CLARIFICATION_PROMPT}
    
Estado atual da máquina: ${String(input.currentSession || 'IDLE')}
Payload atual: ${JSON.stringify(meta)}`;

    const llmRes = await this.llm.analyze(
      {
        currentState: input.currentSession || 'IDLE',
        payload: meta,
        userMessage: text,
      },
      systemPromptWithContext,
    );

    const {
      classification,
      suggestedReply,
      extracted,
    } = llmRes;

    // 🔹 CANCEL → cancelar fluxo
    if (classification === 'cancel') {
      return {
        actions: [
          { type: 'cancel' },
          { type: 'reply', text: suggestedReply },
        ],
        nucleus: 'clarification',
      };
    }

    // 🔹 NEW INTENT → redirect
    if (classification === 'new_intent') {
      return {
        actions: [
          {
            type: 'redirect',
            to: 'GOAL_CREATION', // Orchestrator decide o destino real depois
            payload: extracted?.payload || {},
          },
        ],
        nucleus: 'clarification',
      };
    }

    // 🔹 QUALQUER OUTRO CASO → reply
    return {
      actions: [
        {
          type: 'reply',
          text: suggestedReply,
        },
      ],
      nucleus: 'clarification',
    };
  } catch (e) {
    this.logger.warn('Clarification LLM failed', e);

    return {
      actions: [
        {
          type: 'reply',
          text: 'Não entendi bem — pode explicar em uma frase curta?',
        },
      ],
      nucleus: 'clarification',
    };
  }
}
}

export default ClarificationNucleus;
