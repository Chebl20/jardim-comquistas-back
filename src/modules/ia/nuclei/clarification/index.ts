import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, NucleusResult } from '../nucleus.interface';
import { ConversationAIService } from '../../conversation-ai.service';
import { PROMPT as CLARIFICATION_PROMPT } from '../clarification/prompt';

@Injectable()
export class ClarificationNucleus {
  private readonly logger = new Logger(ClarificationNucleus.name);
  public static PROMPT = CLARIFICATION_PROMPT;
  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<NucleusResult> {
    const text = (input.text || '').trim();
    const withEmoji = (s: string) => (s && s.trim().endsWith('🙂')) ? s : `${s} 🙂`;
    const low = text.toLowerCase();
    // Gibberish detection: mensagens sem sentido (ex: "kdjqw12@@@" ou sequências aleatórias)
    const isGibberish = (s: string) => {
      const cleaned = (s || '').replace(/\s+/g, '');
      if (!cleaned) return false;
      const letters = (cleaned.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
      const numbers = (cleaned.match(/[0-9]/g) || []).length;
      const punctuation = (cleaned.match(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]/g) || []).length;
      const letterRatio = letters / cleaned.length;
      const vowelRatio = (cleaned.match(/[aeiouáéíóúâêîôûãõàèìòùü]/gi) || []).length / Math.max(1, letters);
      if (cleaned.length < 3) return false;
      if (letterRatio < 0.45 || vowelRatio < 0.15) return true;
      if (numbers / cleaned.length > 0.6) return true;
      if (punctuation / cleaned.length > 0.6) return true;
      return false;
    };

    // Resposta curta e direta para mensagens sem sentido — seja acolhedor e sugira próximo passo
    if (isGibberish(text)) {
      const fallback = 'Tudo bem — não consegui entender sua mensagem. Pode reformular em uma frase curta ou dizer "ajuda" para ver opções?';
      return {
        confidence: 0.2,
        suggestedReply: fallback,
        stopPropagation: true,
        nucleus: 'clarification',
      };
    }

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
      interface ClarificationResult extends NucleusResult {
        classification: string;
        intent?: string;
      }

      const llmAny: any = llmRes as any;
      const suggestedReply = String((llmAny && (llmAny.suggestedReply || llmAny.suggested)) || '');
      const confidence = typeof llmAny?.confidence === 'number' ? llmAny.confidence : 0.4;

      // Use `classification` as the canonical field. If the model returns `type`,
      // warn (for migration) but prefer `classification`.
      let classification = 'unknown';
      if (typeof llmAny?.classification === 'string') classification = String(llmAny.classification).trim();
      else if (typeof llmAny?.type === 'string') {
        try { this.logger.warn('Clarification: model returned `type` field — prefer `classification`.'); } catch (_) {}
        classification = String(llmAny.type).trim();
      }

      let intent: string | undefined = undefined;
      if (llmAny && typeof llmAny.intent === 'string') intent = String(llmAny.intent).trim();
      else if (llmAny && llmAny.action && typeof llmAny.action === 'object' && typeof llmAny.action.intent === 'string') intent = String(llmAny.action.intent).trim();

      // Architectural rule: when classification === 'new_intent', `intent` is
      // mandatory. Do NOT infer or guess intent here — treat missing intent as
      // invalid output from the model, log it, and return an invalid result so
      // the orchestrator does not transition implicitly.
      if (classification === 'new_intent' && !intent) {
        try {
          this.logger.error('Clarification returned new_intent without intent', JSON.stringify(llmAny));
        } catch (_) {
          this.logger.error('Clarification returned new_intent without intent (failed to stringify llm response)');
        }
        return { confidence: 0.1, suggestedReply: 'Desculpe — não consegui interpretar sua intenção. Pode explicar novamente?', stopPropagation: true, classification: 'invalid_output' } as any;
      }

      const safeResult: ClarificationResult = { confidence, suggestedReply, classification, intent } as any;
      // Ensure Clarification does not produce user-facing handoff prompts when
      // it only classifies a new intent. The orchestrator is responsible for
      // invoking the target nucleus and returning its reply.
      if (safeResult.classification === 'new_intent') {
        safeResult.suggestedReply = '';
      }
      if (llmAny && llmAny.extracted && typeof llmAny.extracted === 'object') safeResult.extracted = llmAny.extracted;

      // Clarification remains a conversational gateway: do not return actionable 'action' fields
      return {
        ...safeResult,
        nucleus: 'clarification',
      } as NucleusResult;
    } catch (e) {
      this.logger.warn('Clarification LLM failed', e);
      return {
        confidence: 0.3,
        suggestedReply: 'Não entendi bem — pode explicar em uma frase curta ou dizer "ajuda" para opções?',
        nucleus: 'clarification',
      };
    }
  }
}

export default ClarificationNucleus;
