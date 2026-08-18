import { Injectable, Logger } from '@nestjs/common';
import type { EvolutionReplyContext } from './whatsapp-webhook.util';

export type ChatPresenceState = 'composing' | 'paused';

export type EvolutionSendTextOptions = {
  replyContext?: EvolutionReplyContext | null;
};

export class EvolutionSendTextError extends Error {
  constructor(
    readonly target: string,
    readonly failures: string[],
  ) {
    super(
      `Evolution API sendText failed for target ${target}: ${failures.join(' | ')}`,
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
    normalized.includes('no lid found') ||
    normalized.includes('not-authorized') ||
    normalized.includes('401')
  );
}

@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);

  private get baseUrl(): string {
    return (process.env.EVOLUTION_BASE_URL || 'http://localhost:8080').replace(
      /\/$/,
      '',
    );
  }

  private get apiKey(): string {
    return process.env.EVOLUTION_API_KEY || '';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
    };
  }

  async sendText(phone: string, body: string): Promise<unknown> {
    return this.sendTextWithTargets([phone], body);
  }

  private buildSendTextPayload(
    target: string,
    text: string,
    replyContext?: EvolutionReplyContext | null,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      number: target,
      text,
    };

    if (replyContext?.stanzaId && replyContext.participant) {
      payload.quoted = {
        messageId: replyContext.stanzaId,
        participant: replyContext.participant,
      };
    }

    return payload;
  }

  async sendTextWithTargets(
    targets: string[],
    text: string,
    options: EvolutionSendTextOptions = {},
  ): Promise<unknown> {
    const uniqueTargets = targets.filter(
      (target, index, list) => target && list.indexOf(target) === index,
    );

    const replyContext = options.replyContext;
    const failures: string[] = [];
    const primary = uniqueTargets[0];

    if (!primary) {
      throw new Error('Evolution API sendText failed: no target');
    }

    if (replyContext?.stanzaId) {
      try {
        const result = await this.request(
          'POST',
          '/send/text',
          this.buildSendTextPayload(primary, text, replyContext),
        );
        this.logger.log(
          `[EVOLUTION] sendText ok number=${primary} (quoted reply)`,
        );
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        failures.push(`${primary}[quoted]: ${err.message}`);
        this.logger.warn(
          `[EVOLUTION] sendText quoted falhou number=${primary}: ${err.message}`,
        );
        if (isTerminalSendError(err)) {
          throw new EvolutionSendTextError(primary, failures);
        }
      }
    }

    try {
      const result = await this.request(
        'POST',
        '/send/text',
        this.buildSendTextPayload(primary, text, null),
      );
      this.logger.log(`[EVOLUTION] sendText ok number=${primary}`);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      failures.push(`${primary}: ${err.message}`);
      this.logger.warn(
        `[EVOLUTION] sendText falhou number=${primary}: ${err.message}`,
      );
    }

    throw new EvolutionSendTextError(primary, failures);
  }

  async setPresence(phone: string, state: ChatPresenceState): Promise<unknown> {
    return this.request('POST', '/message/presence', {
      number: phone,
      state,
    });
  }

  async connectInstance(params: {
    webhookUrl: string;
    subscribe: string[];
    immediate?: boolean;
  }): Promise<unknown> {
    return this.request('POST', '/instance/connect', {
      webhookUrl: params.webhookUrl,
      subscribe: params.subscribe,
      immediate: params.immediate ?? false,
    });
  }

  async getStatus(): Promise<unknown> {
    return this.request('GET', '/instance/status');
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error('EVOLUTION_API_KEY não definido');
    }

    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const payload = data as { error?: string; message?: string } | null;
        const alreadyConnected =
          path === '/instance/connect' &&
          (payload?.error?.toLowerCase().includes('already connected') ||
            payload?.message?.toLowerCase().includes('already connected'));
        if (alreadyConnected) {
          return data;
        }
        const detail =
          payload?.error ||
          payload?.message ||
          (typeof data === 'string' ? data : JSON.stringify(data));
        throw new Error(
          `Evolution API ${method} ${path} failed with status ${res.status}: ${detail}`,
        );
      }
      return data;
    } catch (e) {
      throw e;
    }
  }
}
