import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';
import { WuzapiClient } from './wuzapi.client';
import {
  extractTextFromMessage,
  parseWebhookBody,
  phoneFromRemoteJid,
  verifyHmacSignature,
  verifyWebhookToken,
  WuzapiWebhookPayload,
} from './whatsapp-webhook.util';

const MANUAL_DIGEST_TRIGGER = 'DISPARO DE MSG DIARIA';

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private lastSentByPhone = new Map<string, string>();

  constructor(
    private readonly wuzapi: WuzapiClient,
    private readonly userLinkService: UserLinkService,
    private readonly rateLimiter: RateLimiterService,
    private readonly interpreterManager: ConversationOrchestratorService,
    private readonly dailyDigestService: DailyDigestService,
  ) {}

  async onModuleInit() {
    await this.registerWebhookOnBoot();
  }

  public async sendReply(phone: string, text: string, origin?: string) {
    try {
      const normalized = String(phone).replace(/\D/g, '');
      if (this.lastSentByPhone.get(normalized) === String(text).trim()) {
        this.logger.debug(
          'sendReply deduped by in-memory cache; skipping send',
        );
        return null;
      }

      const tag = origin ? `\n\n(origin: ${origin})` : '';
      const res = await this.wuzapi.sendText(normalized, `${text}${tag}`);
      try {
        this.lastSentByPhone.set(normalized, String(text).trim());
        setTimeout(() => {
          try {
            this.lastSentByPhone.delete(normalized);
          } catch (_) {}
        }, 5000);
      } catch (_) {}
      return res;
    } catch (e) {
      this.logger.warn('sendReply failed', e);
    }
  }

  send(phone: string, text: string) {
    return this.sendReply(phone, text, 'whatsapp-service');
  }

  getBusinessNumber(): string {
    return (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  }

  validateWebhookRequest(params: {
    body: any;
    rawBody?: Buffer;
    signatureHeader?: string | string[];
  }): { ok: true; payload: WuzapiWebhookPayload } | { ok: false; reason: string } {
    const expectedToken = process.env.WUZAPI_TOKEN || '';
    const hmacKey = process.env.WUZAPI_HMAC_KEY || '';

    if (hmacKey) {
      const validHmac = verifyHmacSignature(
        params.rawBody,
        params.signatureHeader,
        hmacKey,
      );
      if (!validHmac) {
        return { ok: false, reason: 'invalid_hmac' };
      }
    }

    const payload = parseWebhookBody(params.body);
    if (!payload) {
      return { ok: false, reason: 'invalid_body' };
    }

    if (!verifyWebhookToken(payload.token, expectedToken)) {
      return { ok: false, reason: 'invalid_token' };
    }

    return { ok: true, payload };
  }

  /** Fire-and-forget entry used by the controller after 200 ack. */
  processWebhookAsync(payload: WuzapiWebhookPayload) {
    this.handleIncoming(payload).catch((e) => {
      this.logger.warn('handleIncoming failed', e);
    });
  }

  async handleIncoming(payload: WuzapiWebhookPayload) {
    if (payload.type !== 'Message') return;

    const event = payload.event;
    const info = event?.Info;
    if (!info) return;
    if (info.IsFromMe === true) return;

    const phone = phoneFromRemoteJid(info.RemoteJid || info.Chat || info.Sender);
    if (!phone) {
      this.logger.debug('Ignoring non-user or group message');
      return;
    }

    const text = extractTextFromMessage(event?.Message);
    this.logger.log(`[WHATSAPP] phone=${phone}, text=${text}`);

    if (typeof text !== 'string') {
      await this.sendReply(
        phone,
        'Envie uma mensagem de texto.',
        'whatsapp-service',
      );
      return;
    }

    const user = await this.userLinkService.getUserByWhatsappId(phone);
    if (!user) {
      if (/^[a-f0-9]{8}$/i.test(text.trim())) {
        try {
          const linkedUser = await this.userLinkService.linkWhatsApp(
            text.trim(),
            phone,
          );
          const nome = linkedUser?.name || '';
          await this.sendReply(
            phone,
            `✅ Vinculação realizada com sucesso${nome ? ', ' + nome : ''}! Agora você pode criar suas metas.`,
            'whatsapp-service',
          );
        } catch (e) {
          await this.sendReply(
            phone,
            '❌ Código de vinculação inválido. Gere um novo código no app/web e envie aqui.',
            'whatsapp-service',
          );
        }
      } else {
        await this.sendReply(
          phone,
          '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.',
          'whatsapp-service',
        );
      }
      return;
    }

    await this.userLinkService.setPreferredChannel(user.id, 'WHATSAPP');

    if (text.trim().toUpperCase() === MANUAL_DIGEST_TRIGGER) {
      try {
        const msg = await this.dailyDigestService.sendDigestForUser(user.id);
        if (!msg) {
          await this.sendReply(
            phone,
            'Não foi possível enviar o resumo. Verifique se você tem metas com lembretes.',
            'whatsapp-service',
          );
        }
      } catch (e) {
        this.logger.warn('Manual digest trigger failed', e);
        await this.sendReply(
          phone,
          'Erro ao gerar o resumo diário.',
          'whatsapp-service',
        );
      }
      return;
    }

    try {
      this.wuzapi.setPresence(phone, 'composing').catch(() => {});
      let typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
        this.wuzapi.setPresence(phone, 'composing').catch(() => {});
      }, 4000);

      try {
        const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
        await this.rateLimiter.isAllowed(`wa:${user.id}`, limit, 60);
      } catch (e) {
        this.logger.warn('Rate limiter falhou, continuando', e);
      }

      const onAck = async (msg: string) => {
        clearInterval(typingInterval);
        await this.sendReply(phone, msg);
        this.wuzapi.setPresence(phone, 'composing').catch(() => {});
        typingInterval = setInterval(() => {
          this.wuzapi.setPresence(phone, 'composing').catch(() => {});
        }, 4000);
      };

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
        this.wuzapi.setPresence(phone, 'paused').catch(() => {});
      }

      if (!outcome) return;

      if (outcome.reply) {
        await this.sendReply(
          phone,
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
          phone,
          outcome.result.suggestedReply,
          outcome.result.origin || 'orchestrator',
        );
      }
    } catch (e) {
      try {
        await this.sendReply(
          phone,
          'Erro ao processar sua mensagem.',
          'whatsapp-service',
        );
      } catch (_) {}
    }
  }

  private async registerWebhookOnBoot() {
    if (!this.wuzapi.isConfigured()) {
      this.logger.warn(
        'WUZAPI não configurado (WUZAPI_BASE_URL/WUZAPI_TOKEN); WhatsApp desabilitado',
      );
      return;
    }

    const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBase) {
      this.logger.warn(
        'PUBLIC_BASE_URL não definido; webhook WUZAPI não registrado automaticamente',
      );
      return;
    }

    const path =
      process.env.WUZAPI_WEBHOOK_PATH || '/api/whatsapp/webhook';
    const webhookUrl = `${publicBase}${path.startsWith('/') ? path : `/${path}`}`;

    try {
      const hmacKey = process.env.WUZAPI_HMAC_KEY || '';
      if (hmacKey && hmacKey.length >= 32) {
        await this.wuzapi.setHmacKey(hmacKey);
        this.logger.log('HMAC WUZAPI configurado');
      }

      await this.wuzapi.setWebhook(webhookUrl, ['Message']);
      this.logger.log(`Webhook WUZAPI registrado: ${webhookUrl}`);
    } catch (e) {
      this.logger.warn('Falha ao registrar webhook/HMAC na WUZAPI', e);
    }
  }
}
