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

/** Normaliza eventos de subscribe para o formato Evolution GO (uppercase). */
export function normalizeSubscribeEvents(events: string[]): string[] {
  return events
    .map((event) => event.trim())
    .filter(Boolean)
    .map((event) => event.toUpperCase());
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

  /** Token da instância (UUID) — header apikey nas requisições Evolution GO. */
  private get instanceToken(): string {
    return process.env.EVOLUTION_API_KEY || '';
  }

  isConfigured(): boolean {
    return Boolean(this.instanceToken);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.instanceToken,
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
      isAudio: false,
    });
  }

  async connectInstance(params: {
    webhookUrl: string;
    subscribe: string[];
    immediate?: boolean;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      webhookUrl: params.webhookUrl,
      subscribe: normalizeSubscribeEvents(params.subscribe),
    };

    if (params.immediate === true) {
      body.immediate = true;
    }

    return this.request('POST', '/instance/connect', body);
  }

  async getStatus(): Promise<unknown> {
    return this.request('GET', '/instance/status');
  }

  private formatRequestError(
    method: string,
    path: string,
    status: number,
    detail: string,
  ): string {
    const base = `Evolution API ${method} ${path} failed with status ${status}: ${detail}`;
    if (status === 401) {
      return `${base}. Verifique se EVOLUTION_API_KEY é o token da instância (UUID), não o GLOBAL_API_KEY do servidor Evolution.`;
    }
    return base;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.instanceToken) {
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
          this.formatRequestError(method, path, res.status, detail),
        );
      }
      return data;
    } catch (e) {
      throw e;
    }
  }
}
