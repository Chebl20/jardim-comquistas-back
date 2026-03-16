import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { ConversationAIService } from '../ia/conversation-ai.service';
import { FLOW_STATES } from '../ia/conversation/flow.types';

const MESSAGES = {

  TIME_RESPONSE: "Agora são {time}.",
  MARK_DONE_SUCCESS: "Bom trabalho{comma} {name}! Progresso registrado.",
  RESCHEDULE_SUCCESS: "Tudo bem{comma} {name}, vamos reagendar para amanhã.",
  ABANDON_SUCCESS: "Entendi{comma} {name}. Vamos pausar essa meta.",
  GENERIC_ERROR: "Ops, algo deu errado. Tente novamente.",
  PROGRESS_REGISTERED: "Progresso registrado com sucesso.",
};

function formatMessage(message: string, replacements: Record<string, string>): string {
  let formatted = message;
  for (const [key, value] of Object.entries(replacements)) {
    formatted = formatted.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return formatted;
}

@Injectable()
export class CommunicationService {
  private ai = new ConversationAIService();
  /**
   * Gera resposta para ações simples (ex: MARK_DONE).
   */
  async generateSimpleResponse(intent: string, userId: string, goalId?: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const name = user?.name || '';

    switch (intent) {
      case 'MARK_DONE':
        return formatMessage(MESSAGES.MARK_DONE_SUCCESS, { name, comma: name ? ',' : '' });
      case 'RESCHEDULE_REMINDER':
        return formatMessage(MESSAGES.RESCHEDULE_SUCCESS, { name, comma: name ? ',' : '' });
      case 'ABANDON_GOAL':
        return formatMessage(MESSAGES.ABANDON_SUCCESS, { name, comma: name ? ',' : '' });
      case 'TIME_RESPONSE':
        const currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return formatMessage(MESSAGES.TIME_RESPONSE, { time: currentTime });
      default:
        return MESSAGES.GENERIC_ERROR;
    }
  }

  /** Máximo de caracteres para descrição; se userMessage for maior, trunca ou resume */
  private static readonly MAX_DESCRIPTION_LENGTH = 80;

  /**
   * Gera metadata para GrowthEvent: título criativo e descrição (mensagem do usuário ou fallback).
   * Regra: descrição = userMessage (ou resumo se longo); título = criativo via IA.
   */
  async generateProgressMetadata(userId?: string, opts?: { goalTitle?: string; userMessage?: string }) {
    const goalTitle = opts?.goalTitle || '';
    const userMessage = (opts?.userMessage || '').trim();
    let userName = '';
    if (userId) {
      try {
        const u = await prisma.user.findUnique({ where: { id: String(userId) }, select: { name: true } });
        userName = u?.name || '';
      } catch (e) {
        // ignore
      }
    }

    // Descrição: preferir userMessage; se muito longa, truncar
    let description = '';
    if (userMessage) {
      description = userMessage.length > CommunicationService.MAX_DESCRIPTION_LENGTH
        ? userMessage.slice(0, CommunicationService.MAX_DESCRIPTION_LENGTH - 3) + '...'
        : userMessage;
    }

    // Título: tentar IA para criatividade
    let title = '';
    try {
      const prompt = `Você gera um título curto e criativo para um evento de progresso de meta. ` +
        `goalTitle: "${goalTitle}", userMessage: "${userMessage}". ` +
        `O título deve ser variado (ex: "Um copo à noite", "Hidratação matinal", "Mais um passo"). ` +
        `NÃO repita o goalTitle. Devolva apenas um JSON: {"title":"..."}.`;
      const llm = await this.ai.analyze(
        { currentState: FLOW_STATES.CLARIFICATION, payload: { userName, goalTitle, userMessage }, userMessage: userMessage || '' },
        prompt,
      );
      const text = llm.suggestedReply || '';
      const parsed = JSON.parse(text);
      if (parsed?.title && typeof parsed.title === 'string') {
        title = String(parsed.title).trim();
      }
    } catch (e) {
      // fallback abaixo
    }

    if (!title) {
      title = 'Mais um passo';
    }
    if (!description) {
      const now = new Date();
      const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      description = `Registrado às ${hora}`;
    }
    return { title, description };
  }

  /**
   * Gera mensagem de erro ou confirmação.
   */
  generateErrorMessage(message: string): string {
    return message; // Pode adicionar variações futuras
  }

}
