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

  return null;
}

function normalizeJid(jid: string): string {
  const [userPart, domain] = jid.split('@');
  if (!domain) return jid;
  const baseUser = (userPart || '').split(':')[0];
  return `${baseUser}@${domain}`;
}

/** Phone digits for DB lookup, or full JID (@lid / @s.whatsapp.net) for WUZAPI send. */
export function replyTargetFromEventInfo(info: any): string | null {
  const candidates = [info.Chat, info.Sender, info.RemoteJid, info.SenderAlt].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const jid of candidates) {
    if (jid.endsWith('@g.us')) continue;
    if (jid.includes('@lid') || jid.includes('@s.whatsapp.net')) {
      return normalizeJid(jid);
    }
  }

  const phone = phoneFromEventInfo(info);
  if (phone) return phone;

  return null;
}

export function brazilPhoneVariants(phone: string): string[] {
  const digits = normalizePhone(phone);
  if (!digits) return [];

  const variants = new Set<string>([digits]);
  if (digits.startsWith('55') && digits.length === 12) {
    variants.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    variants.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  return [...variants];
}

/** Controlled candidates for WUZAPI /chat/send/text. Preserve event JIDs; avoid usync storms. */
export function buildSendTextTargets(
  replyTarget: string,
  info?: any,
): string[] {
  const targets: string[] = [];
  const add = (value: string | null | undefined) => {
    const v = String(value || '').trim();
    if (v && !targets.includes(v)) targets.push(v);
  };

  if (info && typeof info === 'object') {
    for (const field of [info.Chat, info.Sender]) {
      if (typeof field === 'string' && field.includes('@lid')) {
        add(normalizeJid(field));
      }
    }
  }

  add(replyTarget);

  if (replyTarget.includes('@')) {
    add(normalizeJid(replyTarget));
  }

  return targets;
}

export type WuzapiReplyContext = {
  stanzaId: string;
  participant: string;
  quotedText: string;
};

/** ContextInfo for replying in-thread (required for many @lid conversations). */
export function buildReplyContextFromEventInfo(
  info: any,
  quotedText?: string,
): WuzapiReplyContext | null {
  if (!info || typeof info !== 'object') return null;

  const stanzaId = info.ID ?? info.Id ?? info.MessageID;
  const participant = info.Sender ?? info.SenderAlt;
  if (!stanzaId || !participant) return null;

  return {
    stanzaId: String(stanzaId),
    participant: String(participant),
    quotedText: String(quotedText ?? ''),
  };
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

export function isOperationalEvent(payload: WuzapiWebhookPayload): boolean {
  const type = String(payload.type || '').toLowerCase();
  return ['loggedout', 'qr', 'qrtimeout', 'undecryptablemessage'].includes(type);
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

export function extractWebhookHeaderToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const tokenHeader = headers['token'] ?? headers['Token'];
  if (typeof tokenHeader === 'string' && tokenHeader.trim()) {
    return tokenHeader.trim();
  }
  if (Array.isArray(tokenHeader) && tokenHeader[0]?.trim()) {
    return tokenHeader[0].trim();
  }

  const auth = headers['authorization'] ?? headers['Authorization'];
  const authValue = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authValue === 'string') {
    const match = authValue.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return undefined;
}

export function isWebhookAuthorized(params: {
  payload: WuzapiWebhookPayload;
  expectedToken: string;
  hmacKey: string;
  rawBody?: Buffer;
  signatureHeader?: string | string[];
  headerToken?: string;
}): { ok: true } | { ok: false; reason: string } {
  const hmacConfigured = params.hmacKey.length >= 32;
  const tokenFromPayload = params.payload.token;
  const tokenCandidates = [tokenFromPayload, params.headerToken].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const tokenValid =
    Boolean(params.expectedToken) &&
    tokenCandidates.some((token) =>
      verifyWebhookToken(token, params.expectedToken),
    );

  if (hmacConfigured) {
    if (
      verifyHmacSignature(
        params.rawBody,
        params.signatureHeader,
        params.hmacKey,
      )
    ) {
      return { ok: true };
    }
    // WUZAPI com HasHmac vazio não envia assinatura — aceitar token igual ao da instância.
    if (tokenValid) {
      return { ok: true };
    }
    return { ok: false, reason: 'invalid_hmac' };
  }

  // WUZAPI com HasHmac vazio: não exige token/HMAC (evita 401 e dead-letter queue).
  return { ok: true };
}
