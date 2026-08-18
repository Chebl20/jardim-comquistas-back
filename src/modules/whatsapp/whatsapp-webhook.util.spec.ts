import {
  isMessageEvent,
  isWebhookAuthorized,
  parseWebhookBody,
  phoneFromEventInfo,
  replyTargetFromEventInfo,
  buildSendTextTargets,
  buildReplyContextFromEventInfo,
  isOperationalEvent,
  extractWebhookHeaderToken,
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
  it('preserves @lid JID even when SenderAlt has the real phone', () => {
    const target = replyTargetFromEventInfo({
      Chat: '28089136451755@lid',
      Sender: '28089136451755:89@lid',
      SenderAlt: '559882066740:89@s.whatsapp.net',
    });
    expect(target).toBe('28089136451755@lid');
  });
});

describe('buildSendTextTargets', () => {
  it('uses a short target list and does not expand to phone variants', () => {
    const info = {
      Chat: '28089136451755@lid',
      Sender: '28089136451755:89@lid',
      SenderAlt: '559882066740:89@s.whatsapp.net',
    };
    const targets = buildSendTextTargets('559882066740', info);

    expect(targets).toEqual(['28089136451755@lid', '559882066740']);
  });
});

describe('isOperationalEvent', () => {
  it('identifies Evolution GO session events that should not trigger replies', () => {
    expect(isOperationalEvent({ event: 'LoggedOut' })).toBe(true);
    expect(isOperationalEvent({ event: 'QR' })).toBe(true);
    expect(isOperationalEvent({ event: 'QRTimeout' })).toBe(true);
    expect(isOperationalEvent({ event: 'QRCode' })).toBe(true);
    expect(isOperationalEvent({ event: 'PairSuccess' })).toBe(true);
    expect(isOperationalEvent({ event: 'Connected' })).toBe(true);
    expect(isOperationalEvent({ event: 'Connection' })).toBe(true);
    expect(isOperationalEvent({ event: 'UndecryptableMessage' })).toBe(true);
    expect(
      isOperationalEvent({ event: 'Message', data: { Info: {} } }),
    ).toBe(false);
  });
});

describe('buildReplyContextFromEventInfo', () => {
  it('builds quoted reply context from Evolution GO Message Info', () => {
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
  it('parses Evolution GO JSON payload with event string and data object', () => {
    const body = {
      event: 'Message',
      instanceId: 'uuid-123',
      instanceToken: 'my-token',
      data: {
        Info: { Chat: '559882066740@s.whatsapp.net', IsFromMe: false },
        Message: { conversation: 'oi' },
      },
    };
    const payload = parseWebhookBody(body);
    expect(payload?.event).toBe('Message');
    expect(payload?.instanceToken).toBe('my-token');
    expect(payload?.data?.Info?.Chat).toBe('559882066740@s.whatsapp.net');
  });

  it('infers Message event when data.Info exists but event is missing', () => {
    const body = {
      data: { Info: { Chat: '559882066740@s.whatsapp.net' } },
    };
    const payload = parseWebhookBody(body);
    expect(payload?.event).toBe('Message');
    expect(isMessageEvent(payload!)).toBe(true);
  });

  it('parses Evolution GO payload from rawBody JSON', () => {
    const body = {
      event: 'Message',
      data: { Info: { Chat: '559882066740@s.whatsapp.net' } },
      instanceToken: 'raw-token',
    };
    const raw = Buffer.from(JSON.stringify(body));
    const payload = parseWebhookBody({}, raw);
    expect(payload?.event).toBe('Message');
    expect(payload?.instanceToken).toBe('raw-token');
  });
});

describe('isWebhookAuthorized', () => {
  const messagePayload = {
    event: 'Message',
    instanceToken: 'secret-token',
    data: { Info: { Chat: '559882066740@s.whatsapp.net' } },
  };

  it('accepts payload when instanceToken matches expectedToken', () => {
    const result = isWebhookAuthorized({
      payload: messagePayload,
      expectedToken: 'secret-token',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts payload via headerToken (apikey header)', () => {
    const result = isWebhookAuthorized({
      payload: { event: 'Message', data: {} },
      expectedToken: 'secret-token',
      headerToken: 'secret-token',
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts all events when expectedToken is not configured', () => {
    const result = isWebhookAuthorized({
      payload: { event: 'Message', data: {} },
      expectedToken: '',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects payload when instanceToken does not match expectedToken', () => {
    const result = isWebhookAuthorized({
      payload: { ...messagePayload, instanceToken: 'wrong-token' },
      expectedToken: 'secret-token',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_instance_token' });
  });

  it('rejects payload without token when expectedToken is configured', () => {
    const result = isWebhookAuthorized({
      payload: { event: 'Message', data: {} },
      expectedToken: 'secret-token',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_instance_token' });
  });
});

describe('extractWebhookHeaderToken', () => {
  it('extracts apikey from request headers', () => {
    const token = extractWebhookHeaderToken({ apikey: 'my-api-key' });
    expect(token).toBe('my-api-key');
  });

  it('falls back to Bearer authorization header', () => {
    const token = extractWebhookHeaderToken({
      authorization: 'Bearer my-bearer-token',
    });
    expect(token).toBe('my-bearer-token');
  });
});
