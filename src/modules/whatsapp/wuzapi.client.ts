import { Injectable, Logger } from '@nestjs/common';
import {
  brazilPhoneVariants,
  buildSendTextTargets,
  normalizePhone,
  phoneFromEventInfo,
  type WuzapiReplyContext,
} from './whatsapp-webhook.util';

export type ChatPresenceState = 'composing' | 'paused';

export type WuzapiSendTextOptions = {
  replyContext?: WuzapiReplyContext | null;
  eventInfo?: any;
};

type HeaderMode = 'token' | 'authorization';

@Injectable()
export class WuzapiClient {
  private readonly logger = new Logger(WuzapiClient.name);

  private get baseUrl(): string {
    return (process.env.WUZAPI_BASE_URL || 'http://localhost:8080').replace(
      /\/$/,
      '',
    );
  }

  private get token(): string {
    return process.env.WUZAPI_TOKEN || '';
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private tokenHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Token: this.token,
    };
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: this.token,
    };
  }

  private resolveHeaders(mode: HeaderMode): Record<string, string> {
    return mode === 'authorization' ? this.authHeaders() : this.tokenHeaders();
  }

  async sendText(phone: string, body: string): Promise<unknown> {
    return this.sendTextWithTargets([phone], body);
  }

  /** Resolve LID via WUZAPI store (fixes "no LID found" for BR numbers). */
  async getUserLid(phoneOrJid: string): Promise<string | null> {
    const trimmed = String(phoneOrJid || '').trim();
    if (!trimmed) return null;

    const path = `/user/lid/${encodeURIComponent(trimmed)}`;
    try {
      const data = (await this.request('GET', path)) as {
        data?: { lid?: string };
        lid?: string;
      };
      const lid = data?.data?.lid ?? data?.lid;
      return typeof lid === 'string' && lid.length > 0 ? lid : null;
    } catch {
      return null;
    }
  }

  async resolveSendTextTargets(
    replyTarget: string,
    eventInfo?: any,
  ): Promise<string[]> {
    const targets = buildSendTextTargets(replyTarget, eventInfo);
    const resolved: string[] = [];
    const add = (value: string | null | undefined) => {
      const v = String(value || '').trim();
      if (v && !resolved.includes(v)) resolved.push(v);
    };

    for (const target of targets) add(target);

    const phone = phoneFromEventInfo(eventInfo) || normalizePhone(replyTarget);
    if (phone) {
      for (const variant of brazilPhoneVariants(phone)) {
        for (const candidate of [variant, `${variant}@s.whatsapp.net`]) {
          const lid = await this.getUserLid(candidate);
          if (lid) add(lid);
        }
      }
    }

    return resolved;
  }

  private buildSendTextPayload(
    target: string,
    body: string,
    replyContext?: WuzapiReplyContext | null,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      Phone: target,
      Body: body,
    };

    if (replyContext?.stanzaId && replyContext.participant) {
      payload.ContextInfo = {
        StanzaID: replyContext.stanzaId,
        Participant: replyContext.participant,
      };
      if (replyContext.quotedText) {
        payload.QuotedText = replyContext.quotedText;
      }
    }

    return payload;
  }

  async sendTextWithTargets(
    targets: string[],
    body: string,
    options: WuzapiSendTextOptions = {},
  ): Promise<unknown> {
    let uniqueTargets = targets.filter(
      (target, index, list) => target && list.indexOf(target) === index,
    );

    if (options.eventInfo) {
      uniqueTargets = await this.resolveSendTextTargets(
        uniqueTargets[0] || '',
        options.eventInfo,
      );
      for (const target of targets) {
        if (target && !uniqueTargets.includes(target)) {
          uniqueTargets.push(target);
        }
      }
    }

    const replyContext = options.replyContext;
    const failures: string[] = [];

    // Reply in-thread first — most reliable for @lid chats.
    if (replyContext?.stanzaId && uniqueTargets.length > 0) {
      const primary = uniqueTargets[0];
      try {
        const result = await this.request(
          'POST',
          '/chat/send/text',
          this.buildSendTextPayload(primary, body, replyContext),
        );
        this.logger.log(
          `[WUZAPI] sendText ok Phone=${primary} (quoted reply)`,
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        failures.push(`${primary}[quoted]: ${err.message}`);
        this.logger.warn(
          `[WUZAPI] sendText quoted falhou Phone=${primary}: ${err.message}`,
        );
      }
    }

    for (const target of uniqueTargets) {
      try {
        const result = await this.request(
          'POST',
          '/chat/send/text',
          this.buildSendTextPayload(target, body, null),
        );
        this.logger.log(`[WUZAPI] sendText ok Phone=${target}`);
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        failures.push(`${target}: ${err.message}`);
        this.logger.warn(
          `[WUZAPI] sendText falhou Phone=${target}: ${err.message}`,
        );
      }
    }

    throw new Error(
      `WUZAPI sendText failed for all targets (${uniqueTargets.join(', ')}): ${failures.join(' | ')}`,
    );
  }

  async setPresence(phone: string, state: ChatPresenceState): Promise<unknown> {
    return this.request('POST', '/chat/presence', { Phone: phone, State: state });
  }

  async setWebhook(webhookURL: string, events: string[] = ['Message']): Promise<unknown> {
    return this.request('POST', '/webhook', {
      webhookurl: webhookURL,
      webhookURL,
      events,
    });
  }

  async getWebhook(): Promise<unknown> {
    return this.request('GET', '/webhook');
  }

  async setHmacKey(hmacKey: string): Promise<unknown> {
    return this.request(
      'POST',
      '/session/hmac/config',
      { hmac_key: hmacKey },
      'authorization',
    );
  }

  async connectSession(
    subscribe: string[],
    immediate = false,
  ): Promise<unknown> {
    return this.request('POST', '/session/connect', {
      Subscribe: subscribe,
      Immediate: immediate,
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    headerMode: HeaderMode = 'token',
  ): Promise<unknown> {
    if (!this.token) {
      throw new Error('WUZAPI_TOKEN não definido');
    }

    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: this.resolveHeaders(headerMode),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const payload = data as { error?: string } | null;
        const alreadyConnected =
          path === '/session/connect' &&
          payload?.error?.toLowerCase() === 'already connected';
        if (alreadyConnected) {
          return data;
        }
        const detail =
          payload?.error ||
          (typeof data === 'string' ? data : JSON.stringify(data));
        throw new Error(
          `WUZAPI ${method} ${path} failed with status ${res.status}: ${detail}`,
        );
      }
      return data;
    } catch (e) {
      throw e;
    }
  }
}
