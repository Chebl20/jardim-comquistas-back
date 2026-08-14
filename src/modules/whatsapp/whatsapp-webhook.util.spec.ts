import {
  isMessageEvent,
  isWebhookAuthorized,
  parseWebhookBody,
  phoneFromEventInfo,
  replyTargetFromEventInfo,
  buildSendTextTargets,
  buildReplyContextFromEventInfo,
} from './whatsapp-webhook.util';

describe('phoneFromEventInfo', () => {
  it('prefers SenderAlt with real WhatsApp JID over @lid Chat', () => {
    const phone = phoneFromEventInfo({
      Chat: '28089136451755@lid',
      Sender: '28089136451755:89@lid',
      SenderAlt: '559882066740:89@s.whatsapp.net',
    });
    expect(phone).toBe('559882066740');
  });

  it('does not treat @lid digits as a phone number', () => {
    const phone = phoneFromEventInfo({
      Chat: '28089136451755@lid',
      Sender: '28089136451755:89@lid',
    });
    expect(phone).toBeNull();
  });
});

describe('replyTargetFromEventInfo', () => {
  it('falls back to @lid JID when real phone is unavailable', () => {
    const target = replyTargetFromEventInfo({
      Chat: '28089136451755:89@lid',
      Sender: '28089136451755:89@lid',
    });
    expect(target).toBe('28089136451755@lid');
  });
});

describe('buildSendTextTargets', () => {
  it('prioritizes @lid JID before phone digits when Chat uses LID', () => {
    const info = {
      Chat: '28089136451755@lid',
      Sender: '28089136451755:89@lid',
      SenderAlt: '559882066740:89@s.whatsapp.net',
    };
    const targets = buildSendTextTargets('559882066740', info);

    expect(targets[0]).toBe('28089136451755@lid');
    expect(targets).toContain('559882066740');
    expect(targets).toContain('5598982066740');
    expect(targets).toContain('559882066740@s.whatsapp.net');
  });
});

describe('buildReplyContextFromEventInfo', () => {
  it('builds quoted reply context from WUZAPI Message Info', () => {
    const ctx = buildReplyContextFromEventInfo(
      {
        ID: '3EB0FB259FC408FC71E7AE',
        Sender: '28089136451755:89@lid',
        Chat: '28089136451755@lid',
        SenderAlt: '559882066740:89@s.whatsapp.net',
      },
      'Quais sao as minhas metas?',
    );

    expect(ctx).toEqual({
      stanzaId: '3EB0FB259FC408FC71E7AE',
      participant: '28089136451755:89@lid',
      quotedText: 'Quais sao as minhas metas?',
    });
  });
});

describe('parseWebhookBody', () => {
  const messageJson = {
    type: 'Message',
    event: { Info: { Chat: '559882066740@s.whatsapp.net' } },
  };

  it('parses WUZAPI form-urlencoded jsonData from raw body', () => {
    const raw = Buffer.from(
      `jsonData=${encodeURIComponent(JSON.stringify(messageJson))}&token=secret-token`,
    );
    const payload = parseWebhookBody({}, raw);
    expect(payload?.type).toBe('Message');
    expect(payload?.token).toBe('secret-token');
    expect(payload?.event?.Info?.Chat).toBe('559882066740@s.whatsapp.net');
  });

  it('infers Message type when event.Info exists without type', () => {
    const payload = parseWebhookBody({
      jsonData: JSON.stringify({
        event: { Info: { Chat: '559882066740@s.whatsapp.net' } },
      }),
    });
    expect(payload?.type).toBe('Message');
    expect(isMessageEvent(payload!)).toBe(true);
  });
});

describe('isWebhookAuthorized', () => {
  const messagePayload = {
    type: 'Message',
    event: { Info: { Chat: '559882066740@s.whatsapp.net' } },
  };

  it('accepts Message events without token when HMAC is not configured', () => {
    const result = isWebhookAuthorized({
      payload: messagePayload,
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts Message events even when form token is invalid and HMAC is off', () => {
    const result = isWebhookAuthorized({
      payload: { ...messagePayload, token: 'wrong' },
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts Message events with valid token in form field', () => {
    const result = isWebhookAuthorized({
      payload: { ...messagePayload, token: 'secret-token' },
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts non-Message events without token when HMAC is not configured', () => {
    const result = isWebhookAuthorized({
      payload: { type: 'ChatPresence', event: {} },
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts webhooks with valid Token header when HMAC is configured but signature is missing', () => {
    const result = isWebhookAuthorized({
      payload: messagePayload,
      expectedToken: 'secret-token',
      hmacKey: 'a'.repeat(32),
      headerToken: 'secret-token',
    });
    expect(result).toEqual({ ok: true });
  });
});
