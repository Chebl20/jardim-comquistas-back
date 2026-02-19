

import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';
import SYSTEM_PROMPT from '../SYSTEM_PROMPT';
import { DateTime } from 'luxon';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createGoalSchema, askInfoSchema, markDoneSchema } from '../schemas';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { prisma } from '../../../prisma/client';
import { logAiAudit } from '../ai-audit.service';
import { CONQUEST_TYPES, inferConquestTypeWithConfidence } from '../conquest-type.enum';
import { createAskInfo } from '../ask-info.util';
import { MESSAGES, formatMessage } from '../messages';
type ChatMessage = ChatCompletionMessageParam;

// Armazena o histórico de conversa por usuário em memória (pode ser substituído por Redis ou banco depois)
const chatHistories: Record<string, ChatMessage[]> = {};


@Injectable()
export class AiService {
  private client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  private ajv: Ajv;
  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
    try {
      this.ajv.addSchema(createGoalSchema, 'intent:CREATE_GOAL');
      this.ajv.addSchema(askInfoSchema, 'intent:ASK_INFO');
      this.ajv.addSchema(markDoneSchema, 'intent:MARK_DONE');
    } catch (e) {
      console.warn('[AI] Falha ao registrar schemas Ajv', e);
    }
  }

  /**
   * Gera uma mensagem de lembrete personalizada para uma meta.
   */
  async generateReminderMessage(goal: { title: string; description?: string | null; conquestType: string }, userName?: string) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: 'Você é um assistente motivacional amigável. Gere uma mensagem curta de lembrete (máx 100 caracteres) em português para lembrar o usuário de cumprir sua meta. Use emojis e seja encorajador. Retorne apenas a mensagem de texto, sem aspas ou JSON.'
      },
      {
        role: 'user',
        content: `Meta: "${goal.title}"${goal.description ? ` - ${goal.description}` : ''}. Tipo: ${goal.conquestType}.${userName ? ` Usuário: ${userName}.` : ''} Gere uma mensagem de lembrete motivacional.`
      }
    ];

    try {
      const completion = await this.client.chat.completions.create({ model, temperature: 0.8, messages });
      const content = completion.choices[0].message.content?.trim();
      return content || '⏰ Lembrete: Não esqueça de sua meta! Você consegue! 🌟';
    } catch (e) {
      console.error('[AI] Erro ao gerar mensagem de lembrete:', e);
      return '⏰ Lembrete: Não esqueça de cumprir sua meta! Você consegue! 🌟';
    }
  }
  async generateProgressMetadata(userId?: string, opts?: { goalTitle?: string }) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: 'Gere um pequeno título (máx 8 palavras) e uma descrição curta (máx 30 palavras) em português para um evento de progresso de uma meta do usuário. Retorne apenas um JSON com as chaves "title" e "description".' }];

    if (opts && opts.goalTitle) {
      messages.push({ role: 'user', content: `Meta: ${opts.goalTitle}. Gere título e descrição adequados para um progresso dessa meta.` });
    } else if (userId) {
      try {
        const user = await prisma.user.findUnique({ where: { id: String(userId) } });
        if (user && user.name) messages.push({ role: 'user', content: `Usuário: ${user.name}. Gere título e descrição curtos para um progresso em uma meta pessoal.` });
      } catch (e) {
        // ignore
      }
    } else {
      messages.push({ role: 'user', content: 'Gere título e descrição curtos para um progresso de meta.' });
    }

    try {
      const completion = await this.client.chat.completions.create({ model, temperature: 0.7, messages });
      const content = completion.choices[0].message.content;
      if (!content) throw new Error('Resposta vazia do gerador de metadata');
      // tenta parsear JSON da resposta
      try {
        const parsed = JSON.parse(content);
        return { title: String(parsed.title || '').trim(), description: String(parsed.description || '').trim() };
      } catch (e) {
        // fallback: tenta extrair linhas de texto
        const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        return { title: lines[0] || '', description: lines.slice(1).join(' ') || '' };
      }
    } catch (e) {
      console.warn('[AI] Falha ao gerar progress metadata:', e);
      return { title: '', description: '' };
    }
  }



  /**
   * Interpreta a mensagem do usuário, mantendo o histórico de conversa por chatId.
   * @param message Mensagem do usuário
   * @param chatId Identificador único do chat (ex: Telegram chatId)
   */
  async interpret(message: string, chatId: string | number, opts?: { userId?: string; worldId?: string; goalsContext?: string }) {
    const key = String(chatId);

    // Tentar resolver com regras simples primeiro
    const simpleResponse = await this.trySimpleRules(message, opts?.userId);
    if (simpleResponse) {
      // Adicionar ao histórico se necessário, mas para simples, talvez não
      return simpleResponse;
    }

    // Se não conseguiu resolver simplesmente, chamar IA
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    if (!chatHistories[key]) {
      chatHistories[key] = [];
    }
    // Adiciona a mensagem do usuário ao histórico
    const userMessage = opts?.worldId ? `Usuário está no mundo: ${opts.worldId}. ${opts.goalsContext ? opts.goalsContext + ' ' : ''}${message}` : message;
    chatHistories[key].push({ role: 'user', content: userMessage });
    // Limita o histórico para as últimas 8 trocas
    if (chatHistories[key].length > 16) {
      chatHistories[key] = chatHistories[key].slice(-16);
    }
    // Monta o array de mensagens para o modelo
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Adicionar hora atual sempre — tentar usar timezone do usuário quando disponível
    let currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    try {
      if (opts && opts.userId) {
        const uFull = await prisma.user.findUnique({ where: { id: String(opts.userId) } });
        const tz = (uFull && (uFull as any).timezone) ? (uFull as any).timezone : undefined;
        if (tz) {
          currentTime = DateTime.now().setZone(tz).toFormat('HH:mm');
        } else {
          currentTime = DateTime.now().toFormat('HH:mm');
        }
      } else {
        currentTime = DateTime.now().toFormat('HH:mm');
      }
    } catch (e) {
      currentTime = DateTime.now().toFormat('HH:mm');
    }
    console.log('[AI] CURRENT_TIME:', currentTime);
    messages.push({ role: 'system', content: `CURRENT_TIME: ${currentTime}` });

    // Contexto mínimo: apenas a meta mais recente lembrada e nome do usuário, se houver
    if (opts && opts.userId) {
      try {
        const userId = String(opts.userId);
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        const userName = user?.name || '';
        const recentGoal = await prisma.userGoal.findFirst({
          where: { userId, lastReminderSentAt: { not: null } },
          orderBy: { lastReminderSentAt: 'desc' },
          take: 1,
        });
        if (recentGoal) {
          messages.push({ role: 'system', content: `RECENT_GOAL_CONTEXT: ${JSON.stringify({
            id: recentGoal.id,
            title: recentGoal.title,
            goalType: recentGoal.goalType,
            dailyStatus: recentGoal.dailyStatus,
            lastReminderSentAt: recentGoal.lastReminderSentAt,
            userName,
          })}` });
        } else if (userName) {
          messages.push({ role: 'system', content: `USER_CONTEXT: ${JSON.stringify({ userName })}` });
        }
      } catch (e) {
        console.warn('[AI] Falha ao buscar contexto:', e);
      }
    }

    // adicionar histórico conversacional (últimas mensagens)
    messages.push(...chatHistories[key]);
    try {
      const completion: any = await this.openAIChatCreate({ model, temperature: 0, messages });
      // tenta extrair conteúdo raw (compatível com diferentes versões do SDK)
      let rawContent: any = undefined;
      try {
        rawContent = completion.choices?.[0]?.message?.content ?? completion.output?.[0]?.content?.[0]?.text ?? completion;
      } catch (e) {
        rawContent = completion;
      }

      // audit raw
      try {
        await logAiAudit({ chatId: key, prompt: messages.map(m => ({ role: m.role, content: m.content })), raw: rawContent });
      } catch (e) {
        // ignore audit errors
      }

      if (!rawContent) {
        throw new Error('Resposta da IA vazia.');
      }

      // registrar no histórico como string (se for objeto, stringify)
      const assistantContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
      chatHistories[key].push({ role: 'assistant', content: assistantContent });
      if (chatHistories[key].length > 16) chatHistories[key] = chatHistories[key].slice(-16);

      // tenta parsear diretamente
      let parsed: any = null;
      if (typeof rawContent === 'object') {
        parsed = rawContent;
      } else {
        try {
          parsed = JSON.parse(String(rawContent));
        } catch (e) {
          // tentativa de extrair bloco JSON com regex
          const m = String(rawContent).match(/({[\s\S]*})/);
          if (m) {
            try { parsed = JSON.parse(m[1]); } catch (e2) { parsed = null; }
          }
        }
      }

      if (!parsed) {
        // Falha de parsing: responder amigavelmente
        return { say: 'Desculpe, tive um problema temporário para entender sua mensagem. Pode tentar novamente em alguns segundos?', action: null };
      }

      // Enriquecer ASK_INFO com opções padronizadas
      if (parsed && parsed.action && parsed.action.intent === 'ASK_INFO' && parsed.action.data && parsed.action.data.missing === 'conquestType') {
        if (!parsed.action.data.options || !Array.isArray(parsed.action.data.options) || parsed.action.data.options.length === 0) {
          parsed.action.data.options = CONQUEST_TYPES.slice();
        }
      }

      // Validação por intent usando Ajv
      try {
        const intent = parsed?.action?.intent;
        if (intent) {
          const schemaKey = `intent:${intent}`;
          // tentativa de reparo específico por intent antes de validar
          if (intent === 'ASK_INFO' && parsed.action && parsed.action.data) {
            const d = parsed.action.data;
            if (!d.question && !d.prompt) {
              // gerar pergunta a partir do campo 'missing' ou das opções
              const missing = d.missing || 'informação requerida';
              if (Array.isArray(d.options) && d.options.length > 0) {
                d.question = `Por favor, escolha uma opção para ${missing}: ${d.options.join(' / ')}`;
              } else {
                d.question = `Por favor, informe ${missing}.`;
              }
            }
          }

          if (this.ajv.getSchema && this.ajv.getSchema(schemaKey)) {
            const valid = this.ajv.validate(schemaKey, parsed);
            if (!valid) {
              // registrar erros
              console.warn('[AI] Validation failed for intent', intent, this.ajv.errors);
              return { say: 'Desculpe, não consegui interpretar sua intenção corretamente. Pode dizer de outra forma?', action: null };
            }
          }
        }
      } catch (e) {
        console.warn('[AI] Erro na validação Ajv', e);
      }

      // audit parsed
      try { await logAiAudit({ chatId: key, parsed }); } catch (e) {}
      return parsed;
    } catch (e) {
      console.error('[AI ERROR]', e);
      return { say: 'Desculpe, tive um problema temporário para entender sua mensagem. Pode tentar novamente em alguns segundos?', action: null };
    }
  }

  private async openAIChatCreate(opts: { model: string; temperature?: number; messages: ChatCompletionMessageParam[] }) {
    const maxRetries = 2;
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 10000);
    const baseDelay = 500;

    const attempt = async (n: number): Promise<any> => {
      try {
        const p = this.client.chat.completions.create({
          model: opts.model,
          temperature: opts.temperature,
          messages: opts.messages,
          response_format: { type: 'json_object' },
        });
        return await this.promiseTimeout(p, timeoutMs);
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        const isTransient = /ETIMEDOUT|ECONNRESET|timeout|429|rate limit/i.test(msg);
        if (isTransient && n < maxRetries) {
          const delay = baseDelay * Math.pow(2, n);
          await this.sleep(delay);
          return attempt(n + 1);
        }
        throw err;
      }
    };

    return attempt(0);
  }

  private promiseTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('OpenAI timeout')), ms);
      p.then((res) => { clearTimeout(t); resolve(res); }).catch((err) => { clearTimeout(t); reject(err); });
    });
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private async trySimpleRules(message: string, userId?: string): Promise<any | null> {
    const msg = message.toLowerCase().trim();

    // Detecção rápida de lembretes do tipo "me lembre de X em N minutos" ou "me lembra em N minutos"
    try {
      // Determinar timezone do usuário (fallback Brasília)
      let tz = 'America/Sao_Paulo';
      if (userId) {
        try {
          const uFull = await prisma.user.findUnique({ where: { id: String(userId) } });
          if (uFull && (uFull as any).timezone) tz = (uFull as any).timezone;
        } catch (e) {
          // ignore
        }
      }
      const now = DateTime.now().setZone(tz);
      // padrão: "me lembre de <titulo> em <n> minutos"
      let m = msg.match(/me\s+lembre(?:\s+de)?\s+(.+?)\s+em\s+(\d+)\s*min/);
      if (!m) m = msg.match(/me\s+lembra(?:\s+de)?\s+(.+?)\s+daqui\s+a\s+(\d+)\s*min/);
      if (m) {
        const title = (m[1] || '').trim();
        const minutes = parseInt(m[2], 10) || 0;
        if (minutes > 0 && title) {
          // Calcular reminder no timezone do usuário e armazenar em UTC ISO
          const reminder = now.plus({ minutes }).toUTC().toISO();
          // inferir conquestType básico com confidence
          const lower = title.toLowerCase();
          let conquestType = 'Corpo';
          let conquestConfidence = 0.6;
          try {
            const inf = inferConquestTypeWithConfidence(lower);
            if (inf.type) {
              conquestType = inf.type;
              conquestConfidence = inf.confidence;
            }
          } catch (e) {
            // fallback heuristics
            if (/(estud|ler|aprender)/i.test(lower)) { conquestType = 'Mente'; conquestConfidence = 0.6; }
            else if (/(trabalh|projet|taref)/i.test(lower)) { conquestType = 'Trabalho'; conquestConfidence = 0.6; }
            else if (/(financ|dinheir|pagar)/i.test(lower)) { conquestType = 'Financeiro'; conquestConfidence = 0.6; }
            else if (/(espiritu|oração|medita)/i.test(lower)) { conquestType = 'Espiritual'; conquestConfidence = 0.6; }
          }

          return {
            say: `Beleza — vou criar sua meta pontual e te avisar em ${minutes} minutos.`,
            action: {
              intent: 'CREATE_GOAL',
              data: {
                title: title.charAt(0).toUpperCase() + title.slice(1),
                description: title ? `Lembrete: ${title}` : 'Lembrete rápido',
                goalType: 'Pontual',
                conquestType,
                conquestConfidence,
                reminderTime: reminder,
                userId: userId || undefined,
              },
            },
          };
        }
      }

      // padrão sem título: "me lembre em 5 minutos" -> perguntar título
      let m2 = msg.match(/me\s+lembre(?:\s+em|\s+daqui\s+a)?\s+(\d+)\s*min/);
      if (!m2) m2 = msg.match(/me\s+lembra(?:\s+em|\s+daqui\s+a)?\s+(\d+)\s*min/);
      if (m2) {
        const minutes = parseInt(m2[1], 10) || 0;
          if (minutes > 0) {
          return {
            say: `Sobre o que você quer ser lembrado em ${minutes} minutos? Qual o título da meta?`,
            action: createAskInfo('title', undefined, `Sobre o que você quer ser lembrado em ${minutes} minutos?`),
          };
        }
      }
    } catch (e) {
      // ignore parsing errors
    }

    // Pergunta sobre horário
    if (msg.includes('que horas') || msg.includes('horas são') || msg.includes('hora atual')) {
      const currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return {
        say: formatMessage(MESSAGES.TIME_RESPONSE, { time: currentTime }),
        action: null,
      };
    }

    if (!userId) return null;

    // Buscar nome do usuário
    let userName = '';
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      userName = user?.name || '';
    } catch (e) {
      // ignore
    }

    // Buscar meta mais recente lembrada
    let recentGoal: any = null;
    try {
      recentGoal = await prisma.userGoal.findFirst({
        where: { userId, lastReminderSentAt: { not: null } },
        orderBy: { lastReminderSentAt: 'desc' },
        take: 1,
      });
    } catch (e) {
      return null;
    }
    if (!recentGoal) return null;

    // Marcar como feito
    if (msg.includes('fiz') || msg.includes('feito') || msg.includes('concluí') || msg.includes('completei') || msg.includes('pronto')) {
      return {
        say: formatMessage(MESSAGES.MARK_DONE_SUCCESS, { name: userName, comma: userName ? ',' : '' }),
        action: {
          intent: 'MARK_DONE',
          data: { goalId: recentGoal.id, userId },
        },
      };
    }

    // Não fez, reagendar
    if (msg.includes('não') || msg.includes('amanhã') || msg.includes('depois') || msg.includes('mais tarde')) {
      return {
        say: formatMessage(MESSAGES.RESCHEDULE_SUCCESS, { name: userName, comma: userName ? ',' : '' }),
        action: {
          intent: 'RESCHEDULE_REMINDER',
          data: { goalId: recentGoal.id, when: 'next_cycle', userId },
        },
      };
    }

    // Desistir
    if (msg.includes('desistir') || msg.includes('parar') || msg.includes('não quero mais')) {
      return {
        say: formatMessage(MESSAGES.ABANDON_SUCCESS, { name: userName, comma: userName ? ',' : '' }),
        action: {
          intent: 'ABANDON_GOAL',
          data: { goalId: recentGoal.id, userId },
        },
      };
    }

    // Se não conseguiu resolver, retornar null para chamar IA
    return null;
  }
}
