import { Injectable, Logger } from '@nestjs/common';
import {
  type WuzapiReplyContext,
} from './whatsapp-webhook.util';

export type ChatPresenceState = 'composing' | 'paused';

export type WuzapiSendTextOptions = {
  replyContext?: WuzapiReplyContext | null;
};

type HeaderMode = 'token' | 'authorization';

export class WuzapiSendTextError extends Error {
  constructor(
    readonly target: string,
    readonly failures: string[],
  ) {
    super(
      `WUZAPI sendText failed for target ${target}: ${failures.join(' | ')}`,
    );
  }

  get terminal(): boolean {
    return this.failures.some(isTerminalSendErrorMessage);
  }
}

function isTerminalSendError(error: Error): boolean {
  return isTerminalSendErrorMessage(error.message);
}

function isTerminalSendErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('server returned error 463') ||
    normalized.includes('rate-overlimit') ||
    normalized.includes('429') ||
    normalized.includes('no lid found')
  );
}

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

  /** Resolve LID via WUZAPI store. Do not call this from webhook replies. */
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
    const uniqueTargets = targets.filter(
      (target, index, list) => target && list.indexOf(target) === index,
    );

    const replyContext = options.replyContext;
    const failures: string[] = [];
    const primary = uniqueTargets[0];

    if (!primary) {
      throw new Error('WUZAPI sendText failed: no target');
    }

    // Reply in-thread first. For webhook replies, only retry the same JID once.
    if (replyContext?.stanzaId) {
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
        if (isTerminalSendError(err)) {
          throw new WuzapiSendTextError(primary, failures);
        }
      }
    }

    try {
      const result = await this.request(
        'POST',
        '/chat/send/text',
        this.buildSendTextPayload(primary, body, null),
      );
      this.logger.log(`[WUZAPI] sendText ok Phone=${primary}`);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      failures.push(`${primary}: ${err.message}`);
      this.logger.warn(
        `[WUZAPI] sendText falhou Phone=${primary}: ${err.message}`,
      );
    }

    throw new WuzapiSendTextError(primary, failures);
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
