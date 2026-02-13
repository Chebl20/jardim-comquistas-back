import TelegramBot from 'node-telegram-bot-api';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AiService } from '../ia/openIa/ai.service';
import { IntentRouter } from '../ia/intent-router.service';
import { UserLinkService } from '../users/user-link.service';

@Injectable()

export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;

  constructor(
    private ai: AiService,
    private intentRouter: IntentRouter,
    private userLinkService: UserLinkService,
  ) {}

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN não definido');
    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      this.logger.log(`[TELEGRAM] chatId=${chatId}, text=${text}`);
      if (typeof text !== 'string') {
        this.bot.sendMessage(chatId, 'Envie uma mensagem de texto.');
        return;
      }

      // Checa se o chatId está vinculado a um usuário
      const user = await this.userLinkService.getUserByTelegramId(String(chatId));
      if (!user) {
        // Se o texto for um código de vinculação, tenta vincular
        if (/^[a-f0-9]{8}$/i.test(text.trim())) {
          try {
            const linkedUser = await this.userLinkService.linkTelegram(text.trim(), String(chatId));
            const nome = linkedUser?.name || '';
            await this.bot.sendMessage(chatId, `✅ Vinculação realizada com sucesso${nome ? ", " + nome : ''}! Agora você pode criar suas metas.`);
          } catch (e) {
            await this.bot.sendMessage(chatId, '❌ Código de vinculação inválido. Gere um novo código no app/web e envie aqui.');
          }
        } else {
          await this.bot.sendMessage(chatId, '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.');
        }
        return;
      }

      // Usuário já está vinculado, segue fluxo normal
      try {
        const result = await this.ai.interpret(text, chatId, { userId: user.id });
        await this.bot.sendMessage(chatId, result.say);
        // Garante que o userId real do banco está presente no action
        if (result.action && typeof result.action === 'object') {
          if (!result.action.data) result.action.data = {};
          result.action.data.userId = user.id;
          result.action.data.userName = user.name;
        }
        await this.intentRouter.route(result.action);
      } catch (e) {
        this.bot.sendMessage(chatId, 'Erro ao processar sua mensagem.');
      }
    });
  }

  send(chatId: number, text: string) {
    return this.bot.sendMessage(chatId, text);
  }
}
