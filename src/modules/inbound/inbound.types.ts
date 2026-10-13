export type InboundChannel = 'TELEGRAM' | 'WHATSAPP';

export type InboundTransport = {
  send(text: string, origin?: string): Promise<unknown>;
  startTyping(): void;
  stopTyping(): void;
};

export type InboundRequest = {
  channel: InboundChannel;
  channelUserId: string;
  text: string | null;
  transport: InboundTransport;
};

export const MANUAL_DIGEST_TRIGGER = 'DISPARO DE MSG DIARIA';
