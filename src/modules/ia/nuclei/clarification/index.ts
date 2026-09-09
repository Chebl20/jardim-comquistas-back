import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus } from '../nucleus.interface';
import {
  FlowResult,
  ReplyAction,
  CancelAction,
  RedirectAction,
  FLOW_STATES,
  DECISIONS,
} from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { PROMPT as CLARIFICATION_PROMPT } from '../clarification/prompt';

@Injectable()
export class ClarificationNucleus implements Nucleus<
  ReplyAction | CancelAction | RedirectAction
> {
  private readonly logger = new Logger(ClarificationNucleus.name);
  public static PROMPT = CLARIFICATION_PROMPT;
  constructor(private readonly llm: ConversationAIService) {}

  async analyze(
    input: NucleusInput,
  ): Promise<FlowResult<ReplyAction | CancelAction | RedirectAction>> {
    const text = (input.text || '').trim();
    const meta = input.meta || {};

    try {
      const systemPromptWithContext = CLARIFICATION_PROMPT(
        input.currentSession || FLOW_STATES.CLARIFICATION,
        meta,
      );

      const llmRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: meta,
          userMessage: text,
        },
        systemPromptWithContext,
      );

      const { classification, suggestedReply, extracted } = llmRes;

      // Clarification agora declara quando algo está fora do seu domínio.
      // Se for claramente uma intenção de iniciar outro fluxo (ex: criação de meta),
      // este núcleo deve recusar responsabilidade e devolver `decision: NOT_MY_JOB`
      // com o `extracted` retornado pelo LLM para que o Orchestrator / Router
      // possam encaminhar corretamente. Não deve emitir `actions` nem `suggestedReply`.

      // 🔹 CANCEL → cancelar fluxo
      if (classification === 'cancel') {
        return {
          actions: [
            { type: 'cancel' },
            { type: 'reply', text: suggestedReply },
          ],
          decision: DECISIONS.HANDLED,
          confidence: llmRes.confidence,
        };
      }

      // 🔹 NEW_INTENT → este núcleo não assume mais o redirecionamento direto.
      if (classification === 'new_intent') {
        return {
          actions: [],
          extracted: extracted,
          decision: DECISIONS.NOT_MY_JOB,
          confidence: llmRes.confidence,
        } as FlowResult<ReplyAction | CancelAction | RedirectAction>;
      }

      // 🔹 QUALQUER OUTRO CASO → reply
      return {
        actions: [
          {
            type: 'reply',
            text: suggestedReply,
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: llmRes.confidence,
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
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }
}

export default ClarificationNucleus;
