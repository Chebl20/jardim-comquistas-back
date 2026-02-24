import TelegramBot from 'node-telegram-bot-api';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { prisma } from '../../prisma/client';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationSessionService } from '../shared/conversation-session.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  // Cache curto para evitar envios duplicados enquanto a sessão ainda não
  // foi atualizada no banco (race condition entre sendMessage e gravação).
  private lastSentByChat = new Map<number, string>();

  private async sendReply(chatId: number, text: string, origin?: string) {
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
    private conversationSession: ConversationSessionService,
    private interpreterManager: ConversationOrchestratorService,
  ) {}

  // TelegramService is transport-only: all conversational heuristics live in the orchestrator.

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN não definido');
    this.bot = new TelegramBot(token, { polling: true });

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

      // Usuário já está vinculado — transporte mínimo: delegar ao orquestrador.
      try {
        // Note: orchestration service will enrich context (session, userGoals, worldId, serverTime)

        // Rate limiter (non-blocking)
        try {
          const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
          await this.rateLimiter.isAllowed(`tg:${user.id}`, limit, 60);
        } catch (e) {
          this.logger.warn('Rate limiter falhou, continuando', e);
        }

        // Persistência de recentMessages e log para debug
        try {
          const s = await this.conversationSession.getSession(user.id);
          const prevPayload: any = s && s.payload ? (s.payload as any) : {};
          const prevRecent = Array.isArray(prevPayload.recentMessages)
            ? prevPayload.recentMessages.slice(-5)
            : [];
          const newRecent = prevRecent
            .concat([{ role: 'user', text }])
            .slice(-6); // mantém até 6 últimas mensagens
          const newPayload = { ...prevPayload, recentMessages: newRecent };

          // Atualiza a sessão usando upsert para garantir persistência
          const stateToKeep = s && (s as any).state ? (s as any).state : 'IDLE';
          await this.conversationSession
            .createSession(user.id, stateToKeep, newPayload)
            .catch(async (e) => {
              // fallback para update caso upsert falhe
              try {
                await this.conversationSession.updateSession(user.id, {
                  payload: newPayload,
                });
              } catch (_) {}
            });

          // Ler de volta para garantir que o DB armazenou corretamente (debug)
          try {
            const verified = await this.conversationSession.getSession(user.id);
            const verifiedPayload: any =
              verified && verified.payload ? verified.payload : {};
            const verifiedRecent = Array.isArray(verifiedPayload.recentMessages)
              ? verifiedPayload.recentMessages
              : [];
            const safeVerified = verifiedRecent.map((m: any, i: number) => ({
              index: i,
              role: m.role,
              text: String(m.text).slice(0, 120),
            }));
            // this.logger.debug('TelegramService - recentMessages after DB write: ' + JSON.stringify(safeVerified, null, 2));
          } catch (_) {}

          // --- LOG PARA DEBUG ---
          const safeRecent = newRecent.map((m: any, i: number) => ({
            index: i,
            role: m.role,
            text: String(m.text).slice(0, 120),
          }));
          // this.logger.debug(
          //   'TelegramService - recentMessages persistidos: ' +
          //     JSON.stringify(safeRecent, null, 2),
          // );
        } catch (e) {
          this.logger.debug(
            'TelegramService - falha ao persistir recentMessages',
            e,
          );
        }
        // Delegate everything to the orchestrator
        let outcome: any = null;
        try {
          outcome = await this.interpreterManager.handle({
            userId: user.id,
            userMessage: text,
          });
        } catch (e) {
          this.logger.warn('InterpreterManager failed', e);
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
}
