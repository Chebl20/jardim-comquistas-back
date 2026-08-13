import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';
import { WuzapiClient } from './wuzapi.client';
import type { ConfigureWuzApiResult, ConfigureWuzApiStepResult } from './wuzapi.types';
import {
  buildSendTextTargets,
  extractTextFromMessage,
  isMessageEvent,
  isWebhookAuthorized,
  parseWebhookBody,
  phoneFromEventInfo,
  replyTargetFromEventInfo,
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
    @Inject(forwardRef(() => DailyDigestService))
    private readonly dailyDigestService: DailyDigestService,
  ) {}

  async onModuleInit() {
    const result = await this.configureWuzApi();
    this.logConfigureResult(result);
  }

  getWebhookUrl(): string | null {
    const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBase) return null;

    const path =
      process.env.WUZAPI_WEBHOOK_PATH || '/api/wuzapi/webhook';
    return `${publicBase}${path.startsWith('/') ? path : `/${path}`}`;
  }

  getSubscribeEvents(): string[] {
    const raw = process.env.WUZAPI_SUBSCRIBE_EVENTS || 'Message';
    return raw
      .split(',')
      .map((event) => event.trim())
      .filter(Boolean);
  }

  shouldAutoConnect(): boolean {
    return String(process.env.WUZAPI_AUTO_CONNECT ?? 'true').toLowerCase() !== 'false';
  }

  async configureWuzApi(): Promise<ConfigureWuzApiResult> {
    const emptyStep = (): ConfigureWuzApiStepResult => ({
      ok: false,
      error: 'skipped',
    });

    const result: ConfigureWuzApiResult = {
      webhookUrl: this.getWebhookUrl(),
      webhook: emptyStep(),
      verify: emptyStep(),
      hmac: emptyStep(),
      connect: emptyStep(),
    };

    if (!this.wuzapi.isConfigured()) {
      const error = 'WUZAPI não configurado (WUZAPI_BASE_URL/WUZAPI_TOKEN)';
      result.webhook.error = error;
      return result;
    }

    if (!result.webhookUrl) {
      const error = 'PUBLIC_BASE_URL não definido';
      result.webhook.error = error;
      return result;
    }

    try {
      result.webhook = {
        ok: true,
        data: await this.wuzapi.setWebhook(
          result.webhookUrl,
          this.getSubscribeEvents(),
        ),
      };
    } catch (e) {
      result.webhook = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    try {
      const data = await this.wuzapi.getWebhook();
      result.verify = { ok: true, data };
    } catch (e) {
      result.verify = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const hmacKey = process.env.WUZAPI_HMAC_KEY || '';
    if (hmacKey.length >= 32) {
      try {
        result.hmac = {
          ok: true,
          data: await this.wuzapi.setHmacKey(hmacKey),
        };
      } catch (e) {
        result.hmac = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      result.hmac = { ok: true, error: 'skipped (WUZAPI_HMAC_KEY vazio ou curto)' };
    }

    if (this.shouldAutoConnect()) {
      try {
        result.connect = {
          ok: true,
          data: await this.wuzapi.connectSession(this.getSubscribeEvents(), false),
        };
      } catch (e) {
        result.connect = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      result.connect = { ok: true, error: 'skipped (WUZAPI_AUTO_CONNECT=false)' };
    }

    return result;
  }

  private logConfigureResult(result: ConfigureWuzApiResult) {
    if (!this.wuzapi.isConfigured()) {
      this.logger.warn(
        'WUZAPI não configurado (WUZAPI_BASE_URL/WUZAPI_TOKEN); WhatsApp desabilitado',
      );
      return;
    }

    if (!result.webhookUrl) {
      this.logger.warn(
        'PUBLIC_BASE_URL não definido; webhook WUZAPI não registrado automaticamente',
      );
      return;
    }

    if (result.webhook.ok) {
      this.logger.log(`Webhook WUZAPI registrado: ${result.webhookUrl}`);
    } else {
      this.logger.warn(`Falha ao registrar webhook WUZAPI: ${result.webhook.error}`);
    }

    if (result.verify.ok) {
      const verifyData = result.verify.data as {
        data?: { subscribe?: string[] };
      };
      const subscribed = verifyData?.data?.subscribe ?? [];
      this.logger.log(
        `Webhook WUZAPI verificado: ${JSON.stringify(result.verify.data)}`,
      );
      if (!subscribed.length) {
        this.logger.warn(
          'WUZAPI sem eventos inscritos após registrar webhook; mensagens não serão encaminhadas',
        );
      }
    } else {
      this.logger.warn(`Falha ao verificar webhook WUZAPI: ${result.verify.error}`);
    }

    if (result.hmac.ok && !result.hmac.error?.startsWith('skipped')) {
      this.logger.log('HMAC WUZAPI configurado');
    } else if (!result.hmac.ok) {
      this.logger.warn(`Falha ao configurar HMAC WUZAPI: ${result.hmac.error}`);
    }

    const connectData = result.connect.data as { error?: string } | undefined;
    if (connectData?.error?.toLowerCase() === 'already connected') {
      this.logger.log('Sessão WUZAPI já estava conectada');
    } else if (result.connect.ok && !result.connect.error?.startsWith('skipped')) {
      this.logger.log(
        `Sessão WUZAPI conectada/inscrita: ${JSON.stringify(result.connect.data)}`,
      );
    } else if (!result.connect.ok) {
      this.logger.warn(`Falha ao conectar sessão WUZAPI: ${result.connect.error}`);
    }
  }

  handleWebhookHttpRequest(params: {
    body: any;
    rawBody?: Buffer;
    signatureHeader?: string | string[];
  }):
    | { status: 200; payload: WuzapiWebhookPayload }
    | { status: 401; error: string } {
    const validation = this.validateWebhookRequest(params);
    if (!validation.ok) {
      this.logger.warn(`[WHATSAPP] Webhook rejeitado: ${validation.reason}`);
      return { status: 401, error: validation.reason };
    }

    const payload = validation.payload;
    this.logger.log(
      `[WHATSAPP] Webhook recebido: type=${payload.type ?? 'unknown'}, chat=${payload.event?.Info?.Chat ?? 'n/a'}`,
    );
    return { status: 200, payload };
  }

  public async sendReply(
    target: string,
    text: string,
    origin?: string,
    eventInfo?: any,
  ) {
    try {
      const normalizedTarget = String(target).trim();
      const cacheKey = normalizedTarget.replace(/\D/g, '') || normalizedTarget;
      if (this.lastSentByPhone.get(cacheKey) === String(text).trim()) {
        this.logger.debug(
          'sendReply deduped by in-memory cache; skipping send',
        );
        return null;
      }

      const tag = origin ? `\n\n(origin: ${origin})` : '';
      const message = `${text}${tag}`;
      const targets = buildSendTextTargets(normalizedTarget, eventInfo);
      const res = await this.wuzapi.sendTextWithTargets(targets, message);
      this.logger.log(
        `[WHATSAPP] Resposta enviada para ${normalizedTarget} (tentativas: ${targets.join(' -> ')})`,
      );
      try {
        this.lastSentByPhone.set(cacheKey, String(text).trim());
        setTimeout(() => {
          try {
            this.lastSentByPhone.delete(cacheKey);
          } catch (_) {}
        }, 5000);
      } catch (_) {}
      return res;
    } catch (e) {
      this.logger.warn(
        `[WHATSAPP] Falha ao enviar resposta para ${target}: ${e instanceof Error ? e.message : String(e)}`,
      );
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

    const payload = parseWebhookBody(params.body, params.rawBody);
    if (!payload) {
      return { ok: false, reason: 'invalid_body' };
    }

    const auth = isWebhookAuthorized({
      payload,
      expectedToken,
      hmacKey,
      rawBody: params.rawBody,
      signatureHeader: params.signatureHeader,
    });
    if (!auth.ok) {
      return auth;
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
    if (!isMessageEvent(payload)) {
      this.logger.log(
        `[WHATSAPP] Webhook ignorado: type=${payload.type ?? 'unknown'}`,
      );
      return;
    }

    const event = payload.event;
    const info = event?.Info;
    if (!info) {
      this.logger.warn('[WHATSAPP] Webhook Message sem event.Info');
      return;
    }
    if (info.IsFromMe === true) {
      this.logger.log('[WHATSAPP] Webhook ignorado: mensagem enviada por mim');
      return;
    }

    const phone = phoneFromEventInfo(info);
    const replyTarget = replyTargetFromEventInfo(info);
    if (!replyTarget) {
      this.logger.warn(
        `[WHATSAPP] Webhook ignorado: destino não identificado (Chat=${info.Chat ?? 'n/a'})`,
      );
      return;
    }

    const text = extractTextFromMessage(event?.Message);
    this.logger.log(
      `[WHATSAPP] target=${replyTarget}, phone=${phone ?? 'n/a'}, text=${text}`,
    );

    if (typeof text !== 'string') {
      await this.sendReply(
        replyTarget,
        'Envie uma mensagem de texto.',
        'whatsapp-service',
        info,
      );
      return;
    }

    if (!phone) {
      await this.sendReply(
        replyTarget,
        'Não consegui identificar seu número WhatsApp. Tente enviar o código novamente em alguns segundos.',
        'whatsapp-service',
        info,
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
          this.logger.log(
            `[WHATSAPP] Vinculação realizada: phone=${phone}, userId=${linkedUser.id}${nome ? `, name=${nome}` : ''}`,
          );
          await this.sendReply(
            replyTarget,
            `✅ Vinculação realizada com sucesso${nome ? ', ' + nome : ''}! Agora você pode criar suas metas.`,
            'whatsapp-service',
            info,
          );
        } catch (e) {
          this.logger.log(
            `[WHATSAPP] Vinculação recusada: phone=${phone}, code=${text.trim()}`,
          );
          await this.sendReply(
            replyTarget,
            '❌ Código de vinculação inválido. Gere um novo código no app/web e envie aqui.',
            'whatsapp-service',
            info,
          );
        }
      } else {
        await this.sendReply(
          replyTarget,
          '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.',
          'whatsapp-service',
          info,
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
            replyTarget,
            'Não foi possível enviar o resumo. Verifique se você tem metas com lembretes.',
            'whatsapp-service',
            info,
          );
        }
      } catch (e) {
        this.logger.warn('Manual digest trigger failed', e);
        await this.sendReply(
          replyTarget,
          'Erro ao gerar o resumo diário.',
          'whatsapp-service',
          info,
        );
      }
      return;
    }

    try {
      this.wuzapi.setPresence(replyTarget, 'composing').catch(() => {});
      let typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
        this.wuzapi.setPresence(replyTarget, 'composing').catch(() => {});
      }, 4000);

      try {
        const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
        await this.rateLimiter.isAllowed(`wa:${user.id}`, limit, 60);
      } catch (e) {
        this.logger.warn('Rate limiter falhou, continuando', e);
      }

      const onAck = async (msg: string) => {
        clearInterval(typingInterval);
        await this.sendReply(replyTarget, msg, undefined, info);
        this.wuzapi.setPresence(replyTarget, 'composing').catch(() => {});
        typingInterval = setInterval(() => {
          this.wuzapi.setPresence(replyTarget, 'composing').catch(() => {});
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
        this.wuzapi.setPresence(replyTarget, 'paused').catch(() => {});
      }

      if (!outcome) return;

      if (outcome.reply) {
        await this.sendReply(
          replyTarget,
          outcome.reply,
          outcome.origin || 'orchestrator',
          info,
        );
      }

      if (
        outcome.kind === 'interpret' &&
        outcome.result &&
        outcome.result.suggestedReply
      ) {
        await this.sendReply(
          replyTarget,
          outcome.result.suggestedReply,
          outcome.result.origin || 'orchestrator',
          info,
        );
      }
    } catch (e) {
      try {
        await this.sendReply(
          replyTarget,
          'Erro ao processar sua mensagem.',
          'whatsapp-service',
          info,
        );
      } catch (_) {}
    }
  }
}
