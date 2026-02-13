

import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';
import SYSTEM_PROMPT from '../SYSTEM_PROMPT';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { prisma } from '../../prisma/client';
type ChatMessage = ChatCompletionMessageParam;

// Armazena o histórico de conversa por usuário em memória (pode ser substituído por Redis ou banco depois)
const chatHistories: Record<string, ChatMessage[]> = {};


@Injectable()
export class AiService {
  private client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  /**
   * Gera um título e descrição para um evento de progresso (growth event).
   * Retorna { title, description }.
   */
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
  async interpret(message: string, chatId: string | number, opts?: { userId?: string }) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const key = String(chatId);
    if (!chatHistories[key]) {
      chatHistories[key] = [];
    }
    // Adiciona a mensagem do usuário ao histórico
    chatHistories[key].push({ role: 'user', content: message });
    // Limita o histórico para as últimas 8 trocas
    if (chatHistories[key].length > 16) {
      chatHistories[key] = chatHistories[key].slice(-16);
    }
    // Monta o array de mensagens para o modelo
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Se tiver userId em opts, buscar conquistas/metas do usuário e inserir como contexto
    if (opts && opts.userId) {
      try {
        const userId = String(opts.userId);
        const user = await prisma.user.findUnique({ where: { id: userId }, include: { goals: true } });
        if (user) {
          const goals = (user.goals || []).map((g: any) => ({
            id: g.id,
            title: g.title,
            description: g.description,
            goalType: g.goalType,
            conquestType: g.conquestType,
            frequency: g.frequency,
            reminderTime: g.reminderTime,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
          }));
          messages.push({ role: 'system', content: `USER_GOALS_CONTEXT: ${JSON.stringify({ userId: user.id, name: user.name, goals })}` });
        }
      } catch (e) {
        console.warn('[AI] Falha ao buscar goals do usuário para contexto:', e);
      }
    }

    // adicionar histórico conversacional (últimas mensagens)
    messages.push(...chatHistories[key]);
    try {
      const completion = await this.client.chat.completions.create({
        model,
        temperature: 0,
        messages,
      });
      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('Resposta da IA vazia.');
      }
      // Adiciona a resposta do assistente ao histórico
      chatHistories[key].push({ role: 'assistant', content });
      // Limita o histórico para as últimas 16 trocas
      if (chatHistories[key].length > 16) {
        chatHistories[key] = chatHistories[key].slice(-16);
      }
      return JSON.parse(content);
    } catch (e) {
      console.error('[AI ERROR]', e);
      throw e;
    }
  }
}
