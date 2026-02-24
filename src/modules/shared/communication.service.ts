import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';

const MESSAGES = {
  REMINDERS: [
    "Ei {name}, hora de trabalhar na sua meta: \"{title}\". Você consegue! 💪",
    "Olá {name}! Lembrete para \"{title}\". Vamos fazer acontecer hoje?",
    "{name}, não esqueça: \"{title}\" te espera. Um passo de cada vez!",
    "Oi {name}, é hora de \"{title}\". Estou aqui para te apoiar!",
    "{name}, lembre-se da sua meta: \"{title}\". Vamos juntos nessa!",
  ],
  TIME_RESPONSE: "Agora são {time}.",
  MARK_DONE_SUCCESS: "Bom trabalho{comma} {name}! Progresso registrado.",
  RESCHEDULE_SUCCESS: "Tudo bem{comma} {name}, vamos reagendar para amanhã.",
  ABANDON_SUCCESS: "Entendi{comma} {name}. Vamos pausar essa meta.",
  GENERIC_ERROR: "Ops, algo deu errado. Tente novamente.",
  PROGRESS_REGISTERED: "Progresso registrado com sucesso.",
  WAITING_MESSAGE: "Ei {name}, estou aguardando você cumprir \"{title}\". Vamos lá! 💪",
};

function formatMessage(message: string, replacements: Record<string, string>): string {
  let formatted = message;
  for (const [key, value] of Object.entries(replacements)) {
    formatted = formatted.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return formatted;
}

function randomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

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

  generateWaitingMessage(name: string, title: string): string {
    return formatMessage(MESSAGES.WAITING_MESSAGE, { name, title });
  }
}