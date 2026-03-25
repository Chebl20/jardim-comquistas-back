import TelegramBot from 'node-telegram-bot-api';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';

const MANUAL_DIGEST_TRIGGER = 'DISPARO DE MSG DIARIA';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private botInfo: any; // Cache para informações do bot
  // Cache curto para evitar envios duplicados enquanto a sessão ainda não
  // foi atualizada no banco (race condition entre sendMessage e gravação).
  private lastSentByChat = new Map<number, string>();

  // exposed helper so other services can send messages with origin tag
  public async sendReply(chatId: number, text: string, origin?: string) {
    try {
      // Quick in-memory dedupe to avoid race with DB persistence.
      if (this.lastSentByChat.get(chatId) === String(text).trim()) {
        this.logger.debug(
          'sendReply deduped by in-memory cache; skipping send',
        );
        return null;
      }

      // Deduplicate quickly in-memory only; persistent session checks are handled by the orchestrator.
      const tag = origin ? `\n\n(origin: ${origin})` : '';
      const res = await this.bot.sendMessage(chatId, `${text}${tag}`);
      try {
        this.lastSentByChat.set(chatId, String(text).trim());
        setTimeout(() => {
          try {
            this.lastSentByChat.delete(chatId);
          } catch (_) {}
        }, 5000);
      } catch (_) {}
      // persistent tracking of assistant messages is handled by the orchestrator/session service
      return res;
    } catch (e) {
      this.logger.warn('sendReply failed', e);
    }
  }

  constructor(
    private userLinkService: UserLinkService,
    private rateLimiter: RateLimiterService,
    private interpreterManager: ConversationOrchestratorService,
    private dailyDigestService: DailyDigestService,
  ) {}

  // TelegramService is transport-only: all conversational heuristics live in the orchestrator.

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN não definido');
    this.bot = new TelegramBot(token, { polling: true });

    // Obter informações do bot para ter o nome dinamicamente
    this.bot.getMe().then(botInfo => {
      this.botInfo = botInfo;
      this.logger.log(`Bot iniciado: @${botInfo.username} - ${botInfo.first_name}`);
    }).catch(err => {
      this.logger.error('Erro ao obter informações do bot', err);
    });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      this.logger.log(`[TELEGRAM] chatId=${chatId}, text=${text}`);
      if (typeof text !== 'string') {
        await this.sendReply(
          chatId,
          'Envie uma mensagem de texto.',
          'telegram-service',
        );
        return;
      }

      // Checa se o chatId está vinculado a um usuário
      const user = await this.userLinkService.getUserByTelegramId(
        String(chatId),
      );
      if (!user) {
        // Se o texto for um código de vinculação, tenta vincular
        if (/^[a-f0-9]{8}$/i.test(text.trim())) {
          try {
            const linkedUser = await this.userLinkService.linkTelegram(
              text.trim(),
              String(chatId),
            );
            const nome = linkedUser?.name || '';
            await this.sendReply(
              chatId,
              `✅ Vinculação realizada com sucesso${nome ? ', ' + nome : ''}! Agora você pode criar suas metas.`,
              'telegram-service',
            );
          } catch (e) {
            await this.sendReply(
              chatId,
              '❌ Código de vinculação inválido. Gere um novo código no app/web e envie aqui.',
              'telegram-service',
            );
          }
        } else {
          await this.sendReply(
            chatId,
            '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.',
            'telegram-service',
          );
        }
        return;
      }

      // Gatilho manual para teste do resumo diário (envia a msg diretamente no DailyDigestService)
      if (text.trim().toUpperCase() === MANUAL_DIGEST_TRIGGER) {
        try {
          const msg = await this.dailyDigestService.sendDigestForUser(user.id);
          if (!msg) {
            await this.sendReply(chatId, 'Não foi possível enviar o resumo. Verifique se você tem metas com lembretes.', 'telegram-service');
          }
        } catch (e) {
          this.logger.warn('Manual digest trigger failed', e);
          await this.sendReply(chatId, 'Erro ao gerar o resumo diário.', 'telegram-service');
        }
        return;
      }

      // Usuário já está vinculado — transporte mínimo: delegar ao orquestrador.
      try {
        // Note: orchestration service will enrich context (session, userGoals, worldId, serverTime)

        // Indicador "digitando..." imediato — o Telegram cancela após ~5s sem reenvio
        this.bot.sendChatAction(chatId, 'typing').catch(() => {});
        let typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
          this.bot.sendChatAction(chatId, 'typing').catch(() => {});
        }, 4000);

        // Rate limiter (non-blocking)
        try {
          const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
          await this.rateLimiter.isAllowed(`tg:${user.id}`, limit, 60);
        } catch (e) {
          this.logger.warn('Rate limiter falhou, continuando', e);
        }

        // Callback de ack: para o typing, envia a mensagem e reinicia o typing
        const onAck = async (msg: string) => {
          clearInterval(typingInterval);
          await this.sendReply(chatId, msg);
          this.bot.sendChatAction(chatId, 'typing').catch(() => {});
          typingInterval = setInterval(() => {
            this.bot.sendChatAction(chatId, 'typing').catch(() => {});
          }, 4000);
        };

        // Delegate everything to the orchestrator
        let outcome: any = null;
        try {
          outcome = await this.interpreterManager.handle({
            userId: user.id,
            userMessage: text,
            onAck,
          });
        } catch (e) {
          this.logger.warn('InterpreterManager failed', e);
        } finally {
          clearInterval(typingInterval);
        }

        if (!outcome) return;

        if (outcome.reply) {
          await this.sendReply(
            chatId,
            outcome.reply,
            outcome.origin || 'orchestrator',
          );
        }

        if (
          outcome.kind === 'interpret' &&
          outcome.result &&
          outcome.result.suggestedReply
        ) {
          await this.sendReply(
            chatId,
            outcome.result.suggestedReply,
            outcome.result.origin || 'orchestrator',
          );
          return;
        }
      } catch (e) {
        try {
          await this.sendReply(
            chatId,
            'Erro ao processar sua mensagem.',
            'telegram-service',
          );
        } catch (_) {}
      }
    });
  }

  send(chatId: number, text: string) {
    return this.sendReply(chatId, text, 'telegram-service');
  }

  // Método para obter informações do bot
  getBotInfo() {
    return this.botInfo;
  }

  // Método para obter o username do bot para link
  getBotUsername(): string {
    return this.botInfo?.username || process.env.TELEGRAM_BOT_USERNAME || '';
  }

  // Método para obter o nome completo do bot
  getBotName(): string {
    return this.botInfo?.first_name || '';
  }
}
