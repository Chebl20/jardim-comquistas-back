import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { UserLinkService } from '../users/user-link.service';
import { RateLimiterService } from '../shared/rate-limiter.service';
import { ConversationOrchestratorService } from '../ia/conversation/conversation-orchestrator.service';
import { DailyDigestService } from '../daily-digest/daily-digest.service';
import { EvolutionClient, EvolutionSendTextError } from './evolution.client';
import type { ConfigureEvolutionResult, ConfigureEvolutionStepResult } from './evolution.types';
import {
  buildReplyContextFromEventInfo,
  buildSendTextTargets,
  extractTextFromMessage,
  extractWebhookHeaderToken,
  isMessageEvent,
  isOperationalEvent,
  isWebhookAuthorized,
  parseWebhookBody,
  phoneFromEventInfo,
  replyTargetFromEventInfo,
  EvolutionWebhookPayload,
} from './whatsapp-webhook.util';

const MANUAL_DIGEST_TRIGGER = 'DISPARO DE MSG DIARIA';

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private lastSentByPhone = new Map<string, string>();

  constructor(
    private readonly evolution: EvolutionClient,
    private readonly userLinkService: UserLinkService,
    private readonly rateLimiter: RateLimiterService,
    private readonly interpreterManager: ConversationOrchestratorService,
    @Inject(forwardRef(() => DailyDigestService))
    private readonly dailyDigestService: DailyDigestService,
  ) {}

  async onModuleInit() {
    const result = await this.configureEvolution();
    this.logConfigureResult(result);
  }

  getWebhookUrl(): string | null {
    const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!publicBase) return null;

    const path =
      process.env.EVOLUTION_WEBHOOK_PATH || '/api/evolution/webhook';
    return `${publicBase}${path.startsWith('/') ? path : `/${path}`}`;
  }

  getSubscribeEvents(): string[] {
    const raw = process.env.EVOLUTION_SUBSCRIBE_EVENTS || 'ALL';
    return raw
      .split(',')
      .map((event) => event.trim())
      .filter(Boolean);
  }

  shouldAutoConnect(): boolean {
    return (
      String(process.env.EVOLUTION_AUTO_CONNECT ?? 'true').toLowerCase() !== 'false'
    );
  }

  async configureEvolution(): Promise<ConfigureEvolutionResult> {
    const emptyStep = (): ConfigureEvolutionStepResult => ({
      ok: false,
      error: 'skipped',
    });

    const result: ConfigureEvolutionResult = {
      webhookUrl: this.getWebhookUrl(),
      connect: emptyStep(),
      verify: emptyStep(),
    };

    if (!this.evolution.isConfigured()) {
      const error =
        'Evolution API não configurada (EVOLUTION_BASE_URL/EVOLUTION_API_KEY — token da instância UUID)';
      result.connect.error = error;
      return result;
    }

    if (!result.webhookUrl) {
      const error = 'PUBLIC_BASE_URL não definido';
      result.connect.error = error;
      return result;
    }

    if (this.shouldAutoConnect()) {
      try {
        result.connect = {
          ok: true,
          data: await this.evolution.connectInstance({
            webhookUrl: result.webhookUrl,
            subscribe: this.getSubscribeEvents(),
            immediate: false,
          }),
        };
      } catch (e) {
        result.connect = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      result.connect = { ok: true, error: 'skipped (EVOLUTION_AUTO_CONNECT=false)' };
    }

    try {
      const data = await this.evolution.getStatus();
      result.verify = { ok: true, data };
    } catch (e) {
      result.verify = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return result;
  }

  private logConfigureResult(result: ConfigureEvolutionResult) {
    if (!this.evolution.isConfigured()) {
      this.logger.warn(
        'Evolution API não configurada (EVOLUTION_API_KEY deve ser o token da instância UUID); WhatsApp desabilitado',
      );
      return;
    }

    if (!result.webhookUrl) {
      this.logger.warn(
        'PUBLIC_BASE_URL não definido; webhook Evolution não registrado automaticamente',
      );
      return;
    }

    const connectData = result.connect.data as { error?: string } | undefined;
    if (connectData?.error?.toLowerCase().includes('already connected')) {
      this.logger.log('Instância Evolution já estava conectada');
    } else if (result.connect.ok && !result.connect.error?.startsWith('skipped')) {
      this.logger.log(
        `Instância Evolution conectada: webhookUrl=${result.webhookUrl}, eventos=${this.getSubscribeEvents().join(',')}`,
      );
    } else if (!result.connect.ok) {
      this.logger.warn(`Falha ao conectar instância Evolution: ${result.connect.error}`);
    }

    if (result.verify.ok) {
      this.logger.log(`Status Evolution verificado: ${JSON.stringify(result.verify.data)}`);
    } else {
      this.logger.warn(`Falha ao verificar status Evolution: ${result.verify.error}`);
    }
  }

  handleWebhookHttpRequest(params: {
    body: any;
    rawBody?: Buffer;
    signatureHeader?: string | string[];
    headerToken?: string;
  }):
    | { status: 200; payload: EvolutionWebhookPayload }
    | { status: 401; error: string } {
    const validation = this.validateWebhookRequest(params);
    if (!validation.ok) {
      this.logger.warn(`[WHATSAPP] Webhook rejeitado: ${validation.reason}`);
      return { status: 401, error: validation.reason };
    }

    const payload = validation.payload;
    this.logger.log(
      `[WHATSAPP] Webhook recebido: event=${payload.event ?? 'unknown'}, chat=${payload.data?.Info?.Chat ?? 'n/a'}`,
    );
    return { status: 200, payload };
  }

  public async sendReply(
    target: string,
    text: string,
    origin?: string,
    eventInfo?: any,
    quotedIncomingText?: string,
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
      const replyContext = buildReplyContextFromEventInfo(
        eventInfo,
        quotedIncomingText,
      );
      const res = await this.evolution.sendTextWithTargets(targets, message, {
        replyContext,
      });
      this.logger.log(
        `[WHATSAPP] Resposta enviada para ${normalizedTarget} (send target: ${targets[0]})`,
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
      if (e instanceof EvolutionSendTextError && e.terminal) {
        this.logger.warn(
          `[WHATSAPP] Envio abortado para ${target}: erro terminal da Evolution API (${e.message})`,
        );
        return null;
      }
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
    headerToken?: string;
  }): { ok: true; payload: EvolutionWebhookPayload } | { ok: false; reason: string } {
    const expectedToken = process.env.EVOLUTION_API_KEY || '';

    const payload = parseWebhookBody(params.body, params.rawBody);
    if (!payload) {
      return { ok: false, reason: 'invalid_body' };
    }

    const auth = isWebhookAuthorized({
      payload,
      expectedToken,
      rawBody: params.rawBody,
      signatureHeader: params.signatureHeader,
      headerToken: params.headerToken,
    });
    if (!auth.ok) {
      return auth;
    }

    return { ok: true, payload };
  }

  /** Fire-and-forget entry used by the controller after 200 ack. */
  processWebhookAsync(payload: EvolutionWebhookPayload) {
    this.handleIncoming(payload).catch((e) => {
      this.logger.warn('handleIncoming failed', e);
    });
  }

  async handleIncoming(payload: EvolutionWebhookPayload) {
    if (isOperationalEvent(payload)) {
      this.logger.warn(
        `[WHATSAPP] Evento operacional recebido: event=${payload.event ?? 'unknown'}`,
      );
      return;
    }

    if (!isMessageEvent(payload)) {
      this.logger.log(
        `[WHATSAPP] Webhook ignorado: event=${payload.event ?? 'unknown'}`,
      );
      return;
    }

    // Evolution GO: conteúdo da mensagem em payload.data
    const data = payload.data;
    const info = data?.Info;
    if (!info) {
      this.logger.warn('[WHATSAPP] Webhook Message sem data.Info');
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

    const text = extractTextFromMessage(data?.Message);
    this.logger.log(
      `[WHATSAPP] target=${replyTarget}, phone=${phone ?? 'n/a'}, text=${text}`,
    );

    if (typeof text !== 'string') {
      await this.sendReply(
        replyTarget,
        'Envie uma mensagem de texto.',
        'whatsapp-service',
        info,
        undefined,
      );
      return;
    }

    if (!phone) {
      await this.sendReply(
        replyTarget,
        'Não consegui identificar seu número WhatsApp. Tente enviar o código novamente em alguns segundos.',
        'whatsapp-service',
        info,
        text,
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
            text,
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
            text,
          );
        }
      } else {
        await this.sendReply(
          replyTarget,
          '👋 Olá! Para começar, envie aqui o código de acesso gerado no app/web para vincular sua conta.',
          'whatsapp-service',
          info,
          text,
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
            text,
          );
        }
      } catch (e) {
        this.logger.warn('Manual digest trigger failed', e);
        await this.sendReply(
          replyTarget,
          'Erro ao gerar o resumo diário.',
          'whatsapp-service',
          info,
          text,
        );
      }
      return;
    }

    try {
      const presenceTarget =
        buildSendTextTargets(replyTarget, info)[0] || replyTarget;
      this.evolution.setPresence(presenceTarget, 'composing').catch(() => {});
      let typingInterval: ReturnType<typeof setInterval> = setInterval(() => {
        this.evolution.setPresence(presenceTarget, 'composing').catch(() => {});
      }, 4000);

      try {
        const limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5);
        await this.rateLimiter.isAllowed(`wa:${user.id}`, limit, 60);
      } catch (e) {
        this.logger.warn('Rate limiter falhou, continuando', e);
      }

      const onAck = async (msg: string) => {
        clearInterval(typingInterval);
        await this.sendReply(replyTarget, msg, undefined, info, text);
        this.evolution.setPresence(presenceTarget, 'composing').catch(() => {});
        typingInterval = setInterval(() => {
          this.evolution.setPresence(presenceTarget, 'composing').catch(() => {});
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
        this.evolution.setPresence(presenceTarget, 'paused').catch(() => {});
      }

      if (!outcome) {
        this.logger.warn(
          '[WHATSAPP] Orchestrator não retornou resposta; enviando fallback',
        );
        await this.sendReply(
          replyTarget,
          'Não consegui processar sua mensagem agora. Tente novamente em instantes.',
          'whatsapp-service',
          info,
          text,
        );
        return;
      }

      if (outcome.reply) {
        await this.sendReply(
          replyTarget,
          outcome.reply,
          outcome.origin || 'orchestrator',
          info,
          text,
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
          text,
        );
      }
    } catch (e) {
      try {
        await this.sendReply(
          replyTarget,
          'Erro ao processar sua mensagem.',
          'whatsapp-service',
          info,
          text,
        );
      } catch (_) {}
    }
  }
}
