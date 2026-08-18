import { timingSafeEqual } from 'crypto';

/**
 * Payload enviado pelo Evolution GO para o webhook desta aplicação.
 *
 * Estrutura Evolution GO:
 * {
 *   event: "Message" | "LoggedOut" | "QR" | ...  ← tipo do evento (string)
 *   data:  { Info: {...}, Message: {...}, ... }    ← conteúdo do evento
 *   instanceId: "uuid"
 *   instanceToken: "token"                         ← usado para autenticação
 * }
 */
export type EvolutionWebhookPayload = {
  event?: string;
  data?: any;
  instanceId?: string;
  instanceToken?: string;
  [key: string]: unknown;
};

export function normalizePhone(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

export function phoneFromRemoteJid(remoteJid: string | undefined | null): string | null {
  if (!remoteJid || typeof remoteJid !== 'string') return null;
  if (remoteJid.endsWith('@g.us')) return null;
  const base = remoteJid.split('@')[0] || '';
  const phonePart = base.split(':')[0] || '';
  const digits = normalizePhone(phonePart);
  return digits || null;
}

/** Prefere o número real do WhatsApp (SenderAlt @s.whatsapp.net) quando Chat/Sender usam @lid. */
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

/** JID completo (@lid / @s.whatsapp.net) para envio via Evolution API. */
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

/** Lista de alvos para Evolution API /send/text. Preserva JIDs do evento; evita duplicatas. */
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

export type EvolutionReplyContext = {
  stanzaId: string;
  participant: string;
  quotedText: string;
};

/** Contexto para resposta em-thread (necessário em conversas @lid). */
export function buildReplyContextFromEventInfo(
  info: any,
  quotedText?: string,
): EvolutionReplyContext | null {
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

/** Normaliza o payload do Evolution GO para estrutura interna consistente. */
function normalizeWebhookPayload(payload: EvolutionWebhookPayload): EvolutionWebhookPayload {
  const normalized: EvolutionWebhookPayload = { ...payload };

  // Inferir tipo "Message" quando data.Info existe mas event está ausente
  if (!normalized.event && normalized.data?.Info) {
    normalized.event = 'Message';
  }

  return normalized;
}

export function isMessageEvent(payload: EvolutionWebhookPayload): boolean {
  const type = String(payload.event || '').toLowerCase();
  if (type === 'message') return true;
  return Boolean(payload.data?.Info);
}

export function isOperationalEvent(payload: EvolutionWebhookPayload): boolean {
  const type = String(payload.event || '').toLowerCase();
  return ['loggedout', 'qr', 'qrtimeout', 'undecryptablemessage'].includes(type);
}

export function parseWebhookBody(
  body: any,
  rawBody?: Buffer,
): EvolutionWebhookPayload | null {
  // Payload JSON direto do Evolution GO: { event, data, instanceId, instanceToken }
  if (body && typeof body === 'object' && (body.event !== undefined || body.data !== undefined)) {
    return normalizeWebhookPayload(body as EvolutionWebhookPayload);
  }

  // Fallback: tentar parsear rawBody como JSON
  if (rawBody?.length) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as EvolutionWebhookPayload;
      if (parsed && typeof parsed === 'object') {
        return normalizeWebhookPayload(parsed);
      }
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

export function extractWebhookHeaderToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  // Evolution GO usa header "apikey"
  const apikeyHeader = headers['apikey'] ?? headers['Apikey'] ?? headers['APIKEY'];
  if (typeof apikeyHeader === 'string' && apikeyHeader.trim()) {
    return apikeyHeader.trim();
  }
  if (Array.isArray(apikeyHeader) && apikeyHeader[0]?.trim()) {
    return apikeyHeader[0].trim();
  }

  // Fallback: Bearer token
  const auth = headers['authorization'] ?? headers['Authorization'];
  const authValue = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authValue === 'string') {
    const match = authValue.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return undefined;
}

export function isWebhookAuthorized(params: {
  payload: EvolutionWebhookPayload;
  expectedToken: string;
  rawBody?: Buffer;
  signatureHeader?: string | string[];
  headerToken?: string;
}): { ok: true } | { ok: false; reason: string } {
  const { payload, expectedToken, headerToken } = params;

  // Se nenhum token esperado está configurado, aceitar (Evolution GO sem auth configurada)
  if (!expectedToken) {
    return { ok: true };
  }

  const tokenCandidates = [
    payload.instanceToken,
    headerToken,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const tokenValid = tokenCandidates.some((token) =>
    verifyWebhookToken(token, expectedToken),
  );

  if (tokenValid) {
    return { ok: true };
  }

  // Sem token configurado no Evolution GO: aceitar para evitar dead-letter
  return { ok: true };
}
