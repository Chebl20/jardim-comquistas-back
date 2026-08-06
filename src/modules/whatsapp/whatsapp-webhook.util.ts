import { createHmac, timingSafeEqual } from 'crypto';

export type WuzapiWebhookPayload = {
  type?: string;
  event?: any;
  token?: string;
  [key: string]: unknown;
};

export function normalizePhone(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

export function phoneFromRemoteJid(remoteJid: string | undefined | null): string | null {
  if (!remoteJid || typeof remoteJid !== 'string') return null;
  if (remoteJid.endsWith('@g.us')) return null;
  const base = remoteJid.split('@')[0] || '';
  // device suffix like 5511999999999:12
  const phonePart = base.split(':')[0] || '';
  const digits = normalizePhone(phonePart);
  return digits || null;
}

export function extractTextFromMessage(message: any): string | null {
  if (!message || typeof message !== 'object') return null;
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message?.extendedTextMessage?.text === 'string') {
    return message.extendedTextMessage.text;
  }
  return null;
}

export function parseWebhookBody(body: any): WuzapiWebhookPayload | null {
  if (!body) return null;

  if (typeof body === 'object' && (body.type || body.event || body.jsonData)) {
    if (typeof body.jsonData === 'string') {
      try {
        const parsed = JSON.parse(body.jsonData);
        return {
          ...parsed,
          token: body.token ?? parsed?.token,
        };
      } catch {
        return null;
      }
    }
    return body as WuzapiWebhookPayload;
  }

  return null;
}

export function verifyWebhookToken(
  payloadToken: string | undefined,
  expectedToken: string,
): boolean {
  if (!expectedToken) return false;
  if (!payloadToken) return false;
  const a = Buffer.from(String(payloadToken));
  const b = Buffer.from(String(expectedToken));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyHmacSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | string[] | undefined,
  hmacKey: string,
): boolean {
  if (!hmacKey || hmacKey.length < 32) return false;
  if (!rawBody) return false;
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (!signature) return false;

  const payload =
    typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', hmacKey).update(payload).digest('hex');

  // Accept plain hex or sha256=<hex>
  const provided = signature.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
