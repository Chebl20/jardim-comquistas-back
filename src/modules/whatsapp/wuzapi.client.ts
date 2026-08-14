import { Injectable, Logger } from '@nestjs/common';

export type ChatPresenceState = 'composing' | 'paused';
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

  async sendTextWithTargets(
    targets: string[],
    body: string,
  ): Promise<unknown> {
    const uniqueTargets = targets.filter(
      (target, index, list) => target && list.indexOf(target) === index,
    );
    const failures: string[] = [];
    for (const target of uniqueTargets) {
      try {
        const result = await this.request('POST', '/chat/send/text', {
          Phone: target,
          Body: body,
        });
        this.logger.log(
          `[WUZAPI] sendText ok Phone=${target}`,
        );
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
        this.logger.debug(
          `WUZAPI ${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`,
        );
        const detail =
          payload?.error ||
          (typeof data === 'string' ? data : JSON.stringify(data));
        throw new Error(
          `WUZAPI ${method} ${path} failed with status ${res.status}: ${detail}`,
        );
      }
      return data;
    } catch (e) {
      this.logger.debug(`WUZAPI ${method} ${path} error`, e as Error);
      throw e;
    }
  }
}
