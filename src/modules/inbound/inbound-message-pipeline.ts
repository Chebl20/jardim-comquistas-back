import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';
import {
  MANUAL_DIGEST_TRIGGER,
  type InboundChannel,
  type InboundRequest,
} from './inbound.types';

const LINK_CODE = /^[a-f0-9]{8}$/i;
const TYPING_MS = 4000;

@Injectable()
export class InboundMessagePipeline {
  private readonly logger = new Logger(InboundMessagePipeline.name);

  constructor(
    private readonly userLinkService: UserLinkService,
    @Inject(forwardRef(() => DailyDigestService))
    private readonly dailyDigestService: DailyDigestService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(forwardRef(() => ConversationOrchestratorService))
    private readonly orchestrator: ConversationOrchestratorService,
  ) {}

  async handleInbound(input: InboundRequest): Promise<void> {
    const origin = this.originFor(input.channel);
    const { transport, channel, channelUserId } = input;

    try {
      if (typeof input.text !== 'string') {
        await transport.send('Envie uma mensagem de texto.', origin);
        return;
      }
      const text = input.text;

      const user =
        channel === 'TELEGRAM'
          ? await this.userLinkService.getUserByTelegramId(channelUserId)
          : await this.userLinkService.getUserByWhatsappId(channelUserId);

      if (!user) {
        await this.handleUnlinked(channel, channelUserId, text, transport, origin);
        return;
      }

      await this.userLinkService.setPreferredChannel(user.id, channel);

      if (text.trim().toUpperCase() === MANUAL_DIGEST_TRIGGER) {
        await this.handleDigest(user.id, transport, origin);
        return;
      }

      await this.handleConversation(user.id, text, channel, transport, origin);
    } catch (e) {
      this.logger.warn('handleInbound failed', e);
      try {
        await transport.send('Erro ao processar sua mensagem.', origin);
      } catch (_) {}
    }
  }

  private originFor(channel: InboundChannel): string {
    return channel === 'TELEGRAM' ? 'telegram-service' : 'whatsapp-service';
  }

  private async handleUnlinked(
    channel: InboundChannel,
    channelUserId: string,
    text: string,
    transport: InboundRequest['transport'],
    origin: string,
  ) {
    if (!LINK_CODE.test(text.trim())) {
      await transport.send(
        '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.',
        origin,
      );
      return;
    }
    try {
      const linked =
        channel === 'TELEGRAM'
          ? await this.userLinkService.linkTelegram(text.trim(), channelUserId)
          : await this.userLinkService.linkWhatsApp(text.trim(), channelUserId);
      const nome = linked?.name || '';
      await transport.send(
        `✅ Vinculação realizada com sucesso${nome ? ', ' + nome : ''}! Agora você pode criar suas metas.`,
        origin,
      );
    } catch {
      await transport.send(
        '❌ Código de vinculação inválido. Gere um novo código no app/web e envie aqui.',
        origin,
      );
    }
  }

  private async handleDigest(
    userId: string,
    transport: InboundRequest['transport'],
    origin: string,
  ) {
    try {
      const msg = await this.dailyDigestService.sendDigestForUser(userId);
      if (!msg) {
        await transport.send(
          'Não foi possível enviar o resumo. Verifique se você tem metas com lembretes.',
          origin,
        );
      }
    } catch (e) {
      this.logger.warn('Manual digest trigger failed', e);
      await transport.send('Erro ao gerar o resumo diário.', origin);
    }
  }

  private async handleConversation(
    userId: string,
    text: string,
    channel: InboundChannel,
    transport: InboundRequest['transport'],
    origin: string,
  ) {
    transport.startTyping();
    let typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
      transport.startTyping();
    }, TYPING_MS);

    try {
      const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
      const key = channel === 'TELEGRAM' ? `tg:${userId}` : `wa:${userId}`;
      try {
        await this.rateLimiter.isAllowed(key, limit, 60);
      } catch (e) {
        this.logger.warn('Rate limiter falhou, continuando', e);
      }

      const restartTyping = () => {
        transport.startTyping();
        typingInterval = setInterval(() => {
          transport.startTyping();
        }, TYPING_MS);
      };

      const onAck = async (msg: string) => {
        clearInterval(typingInterval);
        await transport.send(msg);
        restartTyping();
      };

      let outcome: any = null;
      try {
        outcome = await this.orchestrator.handle({
          userId,
          userMessage: text,
          onAck,
        });
      } catch (e) {
        this.logger.warn('InterpreterManager failed', e);
      } finally {
        clearInterval(typingInterval);
        transport.stopTyping();
      }

      if (!outcome) {
        await transport.send(
          'Não consegui processar sua mensagem agora. Tente novamente em instantes.',
          origin,
        );
        return;
      }

      if (outcome.reply) {
        await transport.send(
          outcome.reply,
          outcome.origin || 'orchestrator',
        );
      }

      if (
        outcome.kind === 'interpret' &&
        outcome.result &&
        outcome.result.suggestedReply
      ) {
        await transport.send(
          outcome.result.suggestedReply,
          outcome.result.origin || 'orchestrator',
        );
      }
    } catch (e) {
      clearInterval(typingInterval);
      transport.stopTyping();
      throw e;
    }
  }
}
