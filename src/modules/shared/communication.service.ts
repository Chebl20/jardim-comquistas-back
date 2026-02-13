import { Injectable } from '@nestjs/common';
import { MESSAGES, formatMessage, randomMessage } from '../ia/messages';
import { prisma } from '../../prisma/client';

@Injectable()
export class CommunicationService {
  /**
   * Gera uma mensagem de lembrete aleatória e personalizada.
   */
  async generateReminderMessage(userId: string, goalTitle: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const name = user?.name || '';
    const message = randomMessage(MESSAGES.REMINDERS);
    return formatMessage(message, { name, title: goalTitle });
  }

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
   * Gera mensagem de erro ou confirmação.
   */
  generateErrorMessage(message: string): string {
    return message; // Pode adicionar variações futuras
  }
}