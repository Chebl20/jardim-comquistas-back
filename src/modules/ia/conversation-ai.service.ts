import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import type { Decision } from './conversation/flow.types';
import { DECISIONS } from './conversation/flow.types';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { LLMFormatError } from './errors/llm-format.error';

export interface ConversationAIResult {
  classification: string;
  confidence: number;
  extracted?: {
    payload?: Record<string, any>;
    missing?: string[];
  };
  suggestedReply: string;
  finished?: boolean;
  // decisão explícita de domínio (canônica)
  decision: Decision;
  // quando utilizado pelo roteador, aponta o nome/estado do núcleo a ser
  // chamado a seguir (ex. "GOAL_STATUS" ou "goal-status").
  target?: string;
  // Reminder nucleus: metas mencionadas como concluídas ou dispensadas
  goalIds?: string[];
  goalsCompleted?: Array<{ id: string; title?: string; description?: string }>;
  dismissGoalId?: string;
}

@Injectable()
export class ConversationAIService {
  private readonly logger = new Logger(ConversationAIService.name);
  private client: OpenAI;
  private callCount = 0; // métricas simples

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  private systemPrompt(state: string, payload: any) {
    return `Você é um interpretador conversacional em Português (pt-BR) para um assistente pessoal de metas.
Regras IMPORTANTES:
- Sempre retorne SOMENTE um JSON válido.
- Nunca retorne texto fora do JSON.
- O campo "suggestedReply" deve conter a mensagem FINAL ao usuário.

Formato obrigatório:
{
  "classification": "continue|cancel|new_intent|small_talk|invalid_input|emotional|uncertain",
  "confidence": 0.0-1.0,
  "extracted": {},
  "suggestedReply": "mensagem final ao usuário"
}

Estado atual: ${state}
Payload atual: ${JSON.stringify(payload || {})}`;
  }

  async analyze(
    input: { currentState: string; payload: any; userMessage: string },
    systemPromptOverride?: string,
  ): Promise<ConversationAIResult> {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const systemContent =
      systemPromptOverride || this.systemPrompt(input.currentState, input.payload);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: input.userMessage },
    ];

    this.logger.debug(`ConversationAIService: model=${model}`);

    const start = Date.now();
    const completion = await this.client.chat.completions.create({
      model,
      temperature: 0,
      messages,
    });
    const elapsed = Date.now() - start;
    this.callCount += 1;
    this.logger.log(`LLM call #${this.callCount} took ${elapsed}ms`);

    const raw = completion.choices?.[0]?.message?.content;

    if (!raw) {
      throw new LLMFormatError('Empty response from LLM');
    }

    let parsed: any;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LLMFormatError('Invalid JSON returned by LLM');
    }

    // 🔒 Validação estrutural mínima obrigatória
    // confidence is strictly required; leaving it optional anywhere would
    // break the new architectural contract.
    if (typeof parsed.confidence !== 'number') {
      throw new LLMFormatError('LLM response missing confidence');
    }

    // provide fallbacks so callers don't need to guard
    const classification =
      typeof parsed.classification === 'string' ? parsed.classification : '';
    const suggestedReply =
      typeof parsed.suggestedReply === 'string' ? parsed.suggestedReply : '';

    // Normalizar decision: preferir o campo `parsed.decision` explícito.
    let decision: Decision = DECISIONS.HANDLED;

    if (typeof parsed.decision === 'string') {
      const d = parsed.decision.toLowerCase().replace(/[^a-z_]/g, '');
      if (d === DECISIONS.HANDLED) decision = DECISIONS.HANDLED;
      else if (d === DECISIONS.NOT_MY_JOB) decision = DECISIONS.NOT_MY_JOB;
      else if (d === DECISIONS.UNCERTAIN) decision = DECISIONS.UNCERTAIN;
    } else {
      try {
        const rawSnippet = String(raw).slice(0, 2000);
        this.logger.debug(`LLM returned no explicit decision; raw snippet: ${rawSnippet}`);
      } catch (_) {}
    }

    return {
      classification,
      confidence: parsed.confidence,
      extracted: parsed.extracted,
      suggestedReply,
      finished: parsed.finished,
      decision,
      target: parsed.target,
      goalIds: Array.isArray(parsed.goalIds) ? parsed.goalIds : undefined,
      goalsCompleted: Array.isArray(parsed.goalsCompleted)
        ? parsed.goalsCompleted.filter((g: any) => g && typeof g.id === 'string')
        : undefined,
      dismissGoalId: typeof parsed.dismissGoalId === 'string' ? parsed.dismissGoalId : undefined,
    };
  }
}

export default ConversationAIService;