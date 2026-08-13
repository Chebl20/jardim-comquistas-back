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

/** Prefer real WhatsApp number from SenderAlt when Chat/Sender use @lid. */
export function phoneFromEventInfo(info: any): string | null {
  if (!info || typeof info !== 'object') return null;

  const candidates = [info.SenderAlt, info.RemoteJid, info.Chat, info.Sender].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const jid of candidates) {
    if (jid.includes('@s.whatsapp.net')) {
      const phone = phoneFromRemoteJid(jid);
      if (phone) return phone;
    }
  }

  for (const jid of candidates) {
    const phone = phoneFromRemoteJid(jid);
    if (phone) return phone;
  }

  return null;
}

export function extractTextFromMessage(message: any): string | null {
  if (!message || typeof message !== 'object') return null;
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message?.extendedTextMessage?.text === 'string') {
    return message.extendedTextMessage.text;
  }
  return null;
}

function normalizeWebhookPayload(
  payload: WuzapiWebhookPayload,
  token?: string | null,
): WuzapiWebhookPayload {
  const normalized: WuzapiWebhookPayload = {
    ...payload,
    token: token ?? payload.token,
  };

  if (!normalized.type && normalized.event?.Info) {
    normalized.type = 'Message';
  }

  if (typeof normalized.type === 'string') {
    normalized.type =
      normalized.type.toLowerCase() === 'message'
        ? 'Message'
        : normalized.type;
  }

  return normalized;
}

function parseFormEncodedRawBody(rawBody: Buffer): WuzapiWebhookPayload | null {
  const raw = rawBody.toString('utf8');
  const params = new URLSearchParams(raw);
  const jsonData = params.get('jsonData');
  if (!jsonData) return null;

  try {
    const parsed = JSON.parse(jsonData) as WuzapiWebhookPayload;
    return normalizeWebhookPayload(parsed, params.get('token'));
  } catch {
    return null;
  }
}

export function isMessageEvent(payload: WuzapiWebhookPayload): boolean {
  const type = String(payload.type || '').toLowerCase();
  if (type === 'message') return true;
  return Boolean(payload.event?.Info);
}

export function parseWebhookBody(
  body: any,
  rawBody?: Buffer,
): WuzapiWebhookPayload | null {
  if (body && typeof body === 'object' && (body.type || body.event || body.jsonData)) {
    if (typeof body.jsonData === 'string') {
      try {
        const parsed = JSON.parse(body.jsonData) as WuzapiWebhookPayload;
        return normalizeWebhookPayload(parsed, body.token);
      } catch {
        return null;
      }
    }
    return normalizeWebhookPayload(body as WuzapiWebhookPayload);
  }

  if (rawBody?.length) {
    const fromRaw = parseFormEncodedRawBody(rawBody);
    if (fromRaw) return fromRaw;

    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as WuzapiWebhookPayload;
      return normalizeWebhookPayload(parsed);
    } catch {
      // fall through
    }
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

export function isWebhookAuthorized(params: {
  payload: WuzapiWebhookPayload;
  expectedToken: string;
  hmacKey: string;
  rawBody?: Buffer;
  signatureHeader?: string | string[];
}): { ok: true } | { ok: false; reason: string } {
  const hmacConfigured = params.hmacKey.length >= 32;
  if (hmacConfigured) {
    if (
      !verifyHmacSignature(
        params.rawBody,
        params.signatureHeader,
        params.hmacKey,
      )
    ) {
      return { ok: false, reason: 'invalid_hmac' };
    }
    return { ok: true };
  }

  if (isMessageEvent(params.payload)) {
    if (params.payload.token && params.expectedToken) {
      if (!verifyWebhookToken(params.payload.token, params.expectedToken)) {
        return { ok: false, reason: 'invalid_token' };
      }
    }
    return { ok: true };
  }

  if (params.payload.token) {
    if (!verifyWebhookToken(params.payload.token, params.expectedToken)) {
      return { ok: false, reason: 'invalid_token' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'invalid_token' };
}
