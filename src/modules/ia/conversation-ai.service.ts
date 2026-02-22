import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ConversationAIResult {
  action?: string;
  finished: boolean;
  type: 'continue' | 'cancel' | 'new_intent' | 'small_talk' | 'invalid_input' | 'emotional' | 'uncertain';
  classification?: string;
  intent?: string;
  confidence: number;
  extracted?: {
    payload: {};
    title?: string;
    time?: string;
    conquestType?: string;
  };
  suggestedReply: string;
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
Regras IMPORTANTES (leia com atenção):
- Nunca exponha seu raciocínio interno ou passos de pensamento.
- Nunca descreva a intenção do usuário em terceira pessoa (ex: "O usuário está perguntando...").
- Nunca diga que está "classificando" ou explique como chegou à conclusão.
- Sempre retorne SOMENTE um JSON válido, sem texto livre fora do JSON.
- O campo "suggestedReply" deve conter a mensagem FINAL que será enviada ao usuário (texto humano, direto, em português).

Formato de saída exigido (apenas JSON, escreva a palavra json em letras minúsculas no prompt):
{
  "classification": "continue|cancel|new_intent|small_talk|invalid_input|emotional|uncertain",
  "confidence": 0.0-1.0,
  "extracted": { "title"?: "...", "time"?: "...", "conquestType"?: "..." },
  "suggestedReply": "mensagem final ao usuário"
}

Comportamento desejado:
- Se a mensagem for claramente fora do fluxo (small talk, perguntas gerais), retorne 'classification: "small_talk"' com um 'suggestedReply' útil e acolhedor. Nesses casos, NÃO altere o estado da sessão.
- Para perguntas objetivas e factuais (ex: "que horas são?"), responda diretamente em 'suggestedReply' (ex.: "Agora são 18:52 🙂"). Pode adicionar uma nota curta relacionando ao estado atual, se pertinente.
- Nunca proponha transições de estado sem que o backend decida.
- Se houver incerteza, use 'confidence' baixa (< 0.6) e 'classification: "uncertain"'.

Diretriz crítica para qualidade de conversa:

- Não responda apenas com "Não entendi". Quando estiver incerto, gere UMA resposta útil e acionável: (a) proponha uma reformulação curta; (b) ofereça até duas opções para o usuário escolher; ou (c) faça UMA pergunta de esclarecimento objetiva e curta. Mantenha tom amistoso e objetivo.
- Evite repetições literais quando o usuário enviar mensagens semelhantes; varie a formulação e ofereça um próximo passo.

Instruções de estilo:
- Responda em Português (pt-BR), linguagem simples e máxima de 1-2 frases diretas no 'suggestedReply'.
- Se fornecer opções, numere-as (1) / (2) e seja breve.
- Quando preencher 'extracted', use formatos legíveis (ex.: "08:30" para horários).

Exemplos de output (somente para referência, retorne apenas JSON):
1) Small talk
{
  "classification":"small_talk",
  "confidence":0.95,
  "suggestedReply":"Oi! Sou o assistente do Jardim das Conquistas — posso ajudar você a criar uma meta ou apenas conversar. Quer criar uma meta? (1) Sim (2) Não",
  "extracted":{}
}

2) Incerteza — peça reformulação com opções
{
  "classification":"uncertain",
  "confidence":0.45,
  "suggestedReply":"Não tenho certeza se você quer criar uma meta ou só conversar. Você quer (1) Criar meta (2) Apenas conversar?",
  "extracted":{}
}

3) Continuação de sessão
{
  "classification":"continue",
  "confidence":0.92,
  "suggestedReply":"Perfeito — gostei do título. Agora me diga a que horas quer ser lembrado (formato HH:MM).",
  "extracted":{ "title":"Correr" }
}

Estado atual da máquina: ${state}
Payload atual: ${JSON.stringify(payload || {})}`;
  }

  async analyze(input: { currentState: string; payload: any; userMessage: string; }, systemPromptOverride?: string): Promise<ConversationAIResult> {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const systemContent = systemPromptOverride || this.systemPrompt(input.currentState, input.payload);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: `Mensagem do usuário: ${input.userMessage}` },
    ];

    try {
      // TEMP LOGS: model, temperature, prompts and raw response (for audit)
      try {
        this.logger.debug(`ConversationAIService: model=${model}, temperature=0`);
        this.logger.debug('ConversationAIService: userMessage=' + input.userMessage);
      } catch (_) {}

      const completion: any = await this.client.chat.completions.create({ model, temperature: 0, messages });
      const raw: any = completion.choices?.[0]?.message?.content ?? completion;
      try {
        this.logger.debug('ConversationAIService: raw LLM response received');
      } catch (_) {}
      // raw expected to be object or JSON-like
      let parsed: any = null;
      if (typeof raw === 'object') parsed = raw;
      else {
        try { parsed = JSON.parse(String(raw)); } catch (e) {
          const m = String(raw).match(/({[\s\S]*})/);
          if (m) try { parsed = JSON.parse(m[1]); } catch (e2) { parsed = null; }
        }
      }
      if (!parsed) {
        this.logger.warn('ConversationAIService: resposta vazia/invalid JSON');
        return { finished: false, type: 'uncertain', confidence: 0, suggestedReply: 'Desculpe, não entendi direito. Pode reformular?' };
      }
      // Map fields safely, but preserve the original `classification` and
      // `intent` returned by the model to avoid losing critical information.
      const classificationRaw = parsed.classification || parsed.type || parsed.result || '';
      const classification = typeof classificationRaw === 'string' ? String(classificationRaw) : '';
      const typeRaw = String(classification).toLowerCase();
      const type = (['continue','cancel','new_intent','small_talk','invalid_input','emotional','uncertain'].includes(typeRaw) ? typeRaw : 'uncertain') as ConversationAIResult['type'];
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || parsed.confidenceScore || 0)));
      const extracted = parsed.extracted || parsed.data || undefined;
      // Preserve empty string when model intentionally returns an empty suggestedReply
      let suggestedReply = '';
      if (Object.prototype.hasOwnProperty.call(parsed, 'suggestedReply')) suggestedReply = String(parsed.suggestedReply);
      else if (Object.prototype.hasOwnProperty.call(parsed, 'reply')) suggestedReply = String(parsed.reply);
      else if (Object.prototype.hasOwnProperty.call(parsed, 'response')) suggestedReply = String(parsed.response);
      else suggestedReply = '';
      const intent = typeof parsed.intent === 'string' ? String(parsed.intent) : undefined;
      const action = typeof parsed.action === 'string' ? String(parsed.action) : undefined;
      const finished = !!parsed.finished;
      return { finished, type, classification: classification || undefined, intent, action, confidence, extracted, suggestedReply };
    } catch (e) {
      this.logger.warn('ConversationAIService.analyze failed', e);
      return { finished: false, type: 'uncertain', confidence: 0, suggestedReply: 'Desculpe, tive um problema técnico ao interpretar sua mensagem. Pode, por favor, reformular em uma frase curta ou dizer "ajuda" para opções?' };
    }
  }
}

export default ConversationAIService;
