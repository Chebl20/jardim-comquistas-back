import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, NucleusResult } from '../nuclei/nucleus.interface';
import { ConversationSessionService } from '../../shared/conversation-session.service';

@Injectable()
export class ProcessingNucleus {
  private readonly logger = new Logger(ProcessingNucleus.name);

  constructor(private readonly sessionService: ConversationSessionService) {}

  /**
   * Gerencia mensagens não compreendidas: incrementa contador por sessão
   * e decide respostas escalonadas para evitar repetir mensagens padrões.
   */
  async analyze(input: NucleusInput): Promise<NucleusResult> {
    try {
      const userId = String(input.userId || '');
      const session = await this.sessionService.getSession(userId);
      if (!session) {
        // sem sessão, sugerir reenvio simples
        return { confidence: 0.0, suggestedReply: 'Desculpe, não entendi. Pode enviar novamente, por favor?', stopPropagation: true };
      }

      const payload: any = session.payload || {};
      payload.outOfContextCount = (payload.outOfContextCount || 0) + 1;
      await this.sessionService.updateSession(userId, { payload });

      const threshold = Number(process.env.OUT_OF_CONTEXT_THRESHOLD || 3);
      if (payload.outOfContextCount >= threshold) {
        // Escalada: sugerir reiniciar a criação e encerrar sessão
        const msg = 'Parece que mudamos de assunto 😅 Vamos começar de novo. O que você quer fazer?';
        // delete session to reset
        await this.sessionService.deleteSession(userId);
        this.logger.log(`ProcessingNucleus escalated and reset session for user=${userId}`);
        return { confidence: 1.0, suggestedReply: msg, stopPropagation: true };
      }

      // default: ask to resend
      return { confidence: 0.0, suggestedReply: 'Desculpe, não entendi. Pode enviar novamente, por favor?', stopPropagation: true };
    } catch (e) {
      this.logger.warn('ProcessingNucleus failed', e);
      return { confidence: 0.0, suggestedReply: 'Desculpe, ocorreu um erro interno. Pode tentar novamente?', stopPropagation: true };
    }
  }
}

export default ProcessingNucleus;
