import { Injectable, Logger } from '@nestjs/common';

export type ChatPresenceState = 'composing' | 'paused';

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

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      token: this.token,
    };
  }

  async sendText(phone: string, body: string): Promise<unknown> {
    return this.post('/chat/send/text', { Phone: phone, Body: body });
  }

  async setPresence(phone: string, state: ChatPresenceState): Promise<unknown> {
    return this.post('/chat/presence', { Phone: phone, State: state });
  }

  async setWebhook(webhook: string, events: string[]): Promise<unknown> {
    return this.post('/webhook', { webhook, events });
  }

  async setHmacKey(hmacKey: string): Promise<unknown> {
    return this.post('/session/hmac/config', { hmac_key: hmacKey });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (!this.token) {
      throw new Error('WUZAPI_TOKEN não definido');
    }
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        this.logger.warn(
          `WUZAPI ${path} failed: ${res.status} ${JSON.stringify(data)}`,
        );
        throw new Error(`WUZAPI ${path} failed with status ${res.status}`);
      }
      return data;
    } catch (e) {
      this.logger.warn(`WUZAPI ${path} error`, e as Error);
      throw e;
    }
  }
}
