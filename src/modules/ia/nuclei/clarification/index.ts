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

    // Para todas as outras mensagens, delegar ao LLM com o prompt do núcleo.
    // O prompt instrui o LLM a decidir se é small_talk, pedir esclarecimento, ou continuar o fluxo.
    try {
      const meta = (input.meta || {}) as Record<string, any>;
      const extractConversationContext = (m: Record<string, any> | undefined) => {
        const candidates = m?.conversationHistory || m?.recentMessages || m?.lastMessages || m?.conversation;
        if (!candidates) return '';
        if (Array.isArray(candidates)) {
          const last = candidates.slice(-3);
          return last
            .map((it: any) => {
              if (!it) return '';
              if (typeof it === 'string') return it;
              if (it.role && it.text) return `${it.role}: ${it.text}`;
              if (it.text) return String(it.text);
              return JSON.stringify(it);
            })
            .filter(Boolean)
            .join(' \u2014 ');
        }
        if (typeof candidates === 'string') return candidates;
        return JSON.stringify(candidates);
      };

      // Use structured recentMessages from payload (if present). Do not add a
      // duplicated string `conversationContext` to the prompt or payload — the
      // nucleus will read `payload.recentMessages` directly.
      const systemPromptWithContext = `${CLARIFICATION_PROMPT}\n\nEstado atual da máquina: ${String(input.currentSession || 'IDLE')}\nPayload atual: ${JSON.stringify(meta)}`;
      const payloadForLLM = Object.assign({}, meta);
      // Removed verbose LLM input logging to avoid leaking user/payload data in logs.
      // If you need to debug locally, re-enable a safe, redacted log here.

      // Do not log the full system prompt content to avoid leaking prompts into logs.

      const llmRes = await this.llm.analyze({ currentState: input.currentSession as any || 'IDLE', payload: payloadForLLM, userMessage: text }, systemPromptWithContext);

      // Typed-safe parsing of LLM response to avoid implicit any and ensure
      // deterministic `classification` and `intent` fields for the orchestrator.
      interface ClarificationResult {
        confidence: number;
        suggestedReply?: string;
        classification: string;
        intent?: string;
        extracted?: any;
      }

      const llmAny: any = llmRes as any;
      const suggestedReply = String((llmAny && (llmAny.suggestedReply || llmAny.suggested)) || '');
      const confidence = typeof llmAny?.confidence === 'number' ? llmAny.confidence : 0.4;

      // Use `classification` as the canonical field. Do NOT accept `type`.
      let classification = 'unknown';
      if (typeof llmAny?.classification === 'string') classification = String(llmAny.classification).trim();
      else if (typeof llmAny?.type !== 'undefined') {
        try { this.logger.error('Clarification: model returned deprecated `type` field — required `classification`.'); } catch (_) {}
        // keep classification as 'unknown' so orchestrator remains deterministic
      }

      let intent: string | undefined = undefined;
      if (llmAny && typeof llmAny.intent === 'string') intent = String(llmAny.intent).trim();
      else if (llmAny && llmAny.action && typeof llmAny.action === 'object' && typeof llmAny.action.intent === 'string') intent = String(llmAny.action.intent).trim();

      // Architectural rule: when classification === 'new_intent', `intent` is
      // mandatory. Do NOT infer or guess intent here — treat missing intent as
      // invalid output from the model, log it, and return a safe actions[] result
      // so the orchestrator remains deterministic.
      if (classification === 'new_intent' && !intent) {
        try {
          this.logger.error('Clarification returned new_intent without intent', JSON.stringify(llmAny));
        } catch (_) {
          this.logger.error('Clarification returned new_intent without intent (failed to stringify llm response)');
        }
        return { actions: [{ type: 'reply', text: 'Desculpe — não consegui interpretar sua intenção. Pode explicar novamente?' }], nucleus: 'clarification' } as FlowResult;
      }

      const safeResult: ClarificationResult = { confidence, suggestedReply, classification, intent } as any;
      // Ensure Clarification does not produce user-facing handoff prompts when
      // it only classifies a new intent. The orchestrator is responsible for
      // invoking the target nucleus and returning its reply.
      if (safeResult.classification === 'new_intent') {
        safeResult.suggestedReply = '';
      }
      if (llmAny && llmAny.extracted && typeof llmAny.extracted === 'object') safeResult.extracted = llmAny.extracted;

      // Clarification returns declarative actions for the orchestrator.
      // Default: reply with suggestedReply.
      // When classification === 'new_intent' the nucleus MUST NOT emit a user-facing
      // reply; it should only emit a redirect to the target nucleus. The target
      // nucleus is responsible for asking follow-up questions or confirming.
      const actions: any[] = [];
      if (safeResult.classification === 'new_intent') {
        // Only redirect; do not add a reply here. Preserve the full extracted object
        // so the target nucleus has both payload and missing fields.
        if (intent === 'CREATE_GOAL') actions.push({ type: 'redirect', to: 'GOAL_CREATION', payload: safeResult.extracted || {} });
        else actions.push({ type: 'redirect', to: intent || 'CLARIFICATION', payload: safeResult.extracted || {} });
      } else {
        if (safeResult.suggestedReply) actions.push({ type: 'reply', text: String(safeResult.suggestedReply) });
      }

      return { actions, nucleus: 'clarification' } as FlowResult;
    } catch (e) {
      this.logger.warn('Clarification LLM failed', e);
      return { actions: [{ type: 'reply', text: 'Não entendi bem — pode explicar em uma frase curta ou dizer "ajuda" para opções?' }], nucleus: 'clarification' };
    }
  }
}

export default ClarificationNucleus;
