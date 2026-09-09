import TelegramBot from 'node-telegram-bot-api';

import { Injectable, OnModuleInit, Logger, Inject, forwardRef } from '@nestjs/common';
import { InboundMessagePipeline } from '../inbound/inbound-message-pipeline';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private botInfo: any;
  private lastSentByChat = new Map<number, string>();

  public async sendReply(chatId: number, text: string, origin?: string) {
    try {
      if (this.lastSentByChat.get(chatId) === String(text).trim()) {
        this.logger.debug(
          'sendReply deduped by in-memory cache; skipping send',
        );
        return null;
      }

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
      return res;
    } catch (e) {
      this.logger.warn('sendReply failed', e);
    }
  }

  constructor(
    @Inject(forwardRef(() => InboundMessagePipeline))
    private readonly inbound: InboundMessagePipeline,
  ) {}

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN não definido');
    this.bot = new TelegramBot(token, { polling: true });

    this.bot
      .getMe()
      .then((botInfo) => {
        this.botInfo = botInfo;
        this.logger.log(
          `Bot iniciado: @${botInfo.username} - ${botInfo.first_name}`,
        );
      })
      .catch((err) => {
        this.logger.error('Erro ao obter informações do bot', err);
      });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      this.logger.log(`[TELEGRAM] chatId=${chatId}, text=${text}`);

      await this.inbound.handleInbound({
        channel: 'TELEGRAM',
        channelUserId: String(chatId),
        text: typeof text === 'string' ? text : null,
        transport: {
          send: (body, origin) => this.sendReply(chatId, body, origin),
          startTyping: () => {
            this.bot.sendChatAction(chatId, 'typing').catch(() => {});
          },
          stopTyping: () => {},
        },
      });
    });
  }

  send(chatId: number, text: string) {
    return this.sendReply(chatId, text, 'telegram-service');
  }

  getBotInfo() {
    return this.botInfo;
  }

  getBotUsername(): string {
    return this.botInfo?.username || process.env.TELEGRAM_BOT_USERNAME || '';
  }

  getBotName(): string {
    return this.botInfo?.first_name || '';
  }
}
