import TelegramBot from 'node-telegram-bot-api';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AiService } from '../ia/openIa/ai.service';
import { IntentRouter } from '../ia/intent-router.service';
import { UserLinkService } from '../users/user-link.service';
import { prisma } from '../../prisma/client';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { PendingActionService } from '../shared/pending-action.service';

@Injectable()

export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;

  constructor(
    private ai: AiService,
    private intentRouter: IntentRouter,
    private userLinkService: UserLinkService,
    private rateLimiter: RateLimiterService,
    private pendingActions: PendingActionService,
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
        const worldId = user.currentWorldId || 'mundo1'; // Mundo atual do usuário

        // Buscar metas ativas do usuário para contexto
        const userGoals = await prisma.userGoal.findMany({
          where: { userId: user.id, completed: false },
          include: { plantedTree: true },
        });
        const goalsContext = userGoals.length > 0
          ? 'Suas metas ativas: ' + userGoals.map(g => `${g.title} (id: ${g.id}, mundo: ${g.plantedTree?.worldId || 'desconhecido'})`).join(', ') + '.'
          : 'Você não tem metas ativas no momento.';

        // Rate limit check per user
        try {
          const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
          const rl = await this.rateLimiter.isAllowed(`tg:${user.id}`, limit, 60);
          if (!rl.allowed) {
            await this.bot.sendMessage(chatId, `Você está enviando mensagens muito rapidamente. Aguarde ${Math.ceil(rl.retryAfter || 1)}s e tente novamente.`);
            return;
          }
        } catch (e) {
          // se o rate limiter falhar, não bloquear a mensagem
          this.logger.warn('Rate limiter falhou, continuando', e);
        }

        // Verifica se existe uma ação pendente (ASK_INFO) para este usuário
        const pending = this.pendingActions.consumePending(user.id);
        if (pending) {
          // Interpretar a resposta do usuário para preencher o campo faltante
          const missing = pending.data?.missing;
          const options: string[] = Array.isArray(pending.data?.options) ? pending.data.options : [];
          let chosen: string | undefined = undefined;
          const replyText = String(text).trim();
          // tentar casar com opções
          for (const opt of options) {
            const display = String(opt).replace(/_/g, ' / ').toLowerCase();
            if (replyText.toLowerCase() === opt.toLowerCase() || replyText.toLowerCase() === display.toLowerCase()) {
              chosen = opt;
              break;
            }
          }
          // aceitar índice (1,2,...)
          if (!chosen && /^\d+$/.test(replyText) && options.length > 0) {
            const idx = parseInt(replyText, 10) - 1;
            if (idx >= 0 && idx < options.length) chosen = options[idx];
          }
          if (!chosen && options.length === 1) {
            chosen = options[0];
          }

          if (!chosen && options.length > 0) {
            // não entendeu — reponde com as opções e re-salva a pendência
            const optList = options.map((o, i) => `${i + 1}) ${String(o).replace(/_/g, ' / ')}`).join('\n');
            await this.bot.sendMessage(chatId, `Não entendi. Escolha uma opção:\n${optList}`);
            this.pendingActions.setPending(user.id, pending);
            return;
          }

          // preencher e encaminhar
          const filled = { intent: pending.intent, data: { ...(pending.data || {}) } } as any;
          if (missing) filled.data[missing] = chosen || replyText;
          // garantir userId/worldId
          filled.data.userId = user.id;
          filled.data.userName = user.name;
          filled.data.worldId = worldId;
          await this.intentRouter.route(filled);
          return;
        }

        const result = await this.ai.interpret(text, chatId, { userId: user.id, worldId, goalsContext });

        // If AI requests ASK_INFO, handle it BEFORE sending any say or routing
        if (result.action && typeof result.action === 'object' && result.action.intent === 'ASK_INFO') {
          if (!result.action.data) result.action.data = {};
          const question = result.say || result.action.data.question || 'Por favor, informe o valor solicitado.';
          const options: string[] = Array.isArray(result.action.data.options) ? result.action.data.options : [];
          let messageToSend = question;
          if (options.length > 0) {
            const optList = options.map((o, i) => `${i + 1}) ${String(o).replace(/_/g, ' / ')}`).join('\n');
            messageToSend = `${question}\n\n${optList}`;
          }
          await this.bot.sendMessage(chatId, messageToSend);
          this.logger.log(`[TELEGRAM] Saved pending ASK_INFO for user=${user.id}, missing=${result.action.data?.missing}`);
          this.pendingActions.setPending(user.id, result.action);
          return;
        }

        // Otherwise send say (if any) and route action (if any)
        if (result.say) await this.bot.sendMessage(chatId, result.say);
        if (result.action && typeof result.action === 'object') {
          if (!result.action.data) result.action.data = {};
          result.action.data.userId = user.id;
          result.action.data.userName = user.name;
          result.action.data.worldId = worldId; // Adiciona o worldId ao action
          await this.intentRouter.route(result.action);
        }
      } catch (e) {
        this.bot.sendMessage(chatId, 'Erro ao processar sua mensagem.');
      }
    });
  }

  send(chatId: number, text: string) {
    return this.bot.sendMessage(chatId, text);
  }
}
