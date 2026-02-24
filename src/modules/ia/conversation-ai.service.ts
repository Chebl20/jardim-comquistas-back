import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
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
}

@Injectable()
export class ConversationAIService {
  private readonly logger = new Logger(ConversationAIService.name);
  private client: OpenAI;

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

    const completion = await this.client.chat.completions.create({
      model,
      temperature: 0,
      messages,
    });

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
    if (
      typeof parsed.classification !== 'string' ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.suggestedReply !== 'string'
    ) {
      throw new LLMFormatError('LLM response missing required fields');
    }

    return {
      classification: parsed.classification,
      confidence: parsed.confidence,
      extracted: parsed.extracted,
      suggestedReply: parsed.suggestedReply,
      finished: parsed.finished,
    };
  }
}

export default ConversationAIService;