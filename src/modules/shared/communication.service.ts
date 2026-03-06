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

  /**
   * Gera metadata simples para progresso quando a IA antiga não estiver disponível.
   * Retorna um objeto com `title` e `description` de fallback.
   */
  async generateProgressMetadata(userId?: string, opts?: { goalTitle?: string }) {
    const goalTitle = opts?.goalTitle || '';
    let userName = '';
    if (userId) {
      try {
        const u = await prisma.user.findUnique({ where: { id: String(userId) }, select: { name: true } });
        userName = u?.name || '';
      } catch (e) {
        // ignore
      }
    }

    // try LLM for more creative metadata
    try {
      const prompt = `Você é um gerador de título e descrição curtos para um evento de progresso de meta. ` +
        `Recebe as informações userName: "${userName}", goalTitle: "${goalTitle}". ` +
        `Devolva apenas um JSON válido com campos \\"title\\" e \\"description\\".`;
      const llm = await this.ai.analyze(
        { currentState: FLOW_STATES.CLARIFICATION, payload: { userName, goalTitle }, userMessage: '' },
        prompt,
      );
      const text = llm.suggestedReply || '';
      const parsed = JSON.parse(text);
      if (parsed && parsed.title && parsed.description) {
        return { title: parsed.title, description: parsed.description };
      }
    } catch (e) {
      // fallback to basic heuristic below
    }

    const title = goalTitle ? (goalTitle.split(/\s+/).slice(0, 8).join(' ') || 'Progresso') : (userName ? `Progresso de ${userName}` : 'Progresso');
    const description = goalTitle ? `Progresso em ${goalTitle}` : `Progresso registrado.`;
    return { title, description };
  }

  /**
   * Gera mensagem de erro ou confirmação.
   */
  generateErrorMessage(message: string): string {
    return message; // Pode adicionar variações futuras
  }

}
