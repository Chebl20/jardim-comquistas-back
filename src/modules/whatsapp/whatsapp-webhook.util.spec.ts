import {
  isMessageEvent,
  isWebhookAuthorized,
  parseWebhookBody,
  phoneFromEventInfo,
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

  it('rejects when token is present but invalid', () => {
    const result = isWebhookAuthorized({
      payload: { ...messagePayload, token: 'wrong' },
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('accepts Message events with valid token in form field', () => {
    const result = isWebhookAuthorized({
      payload: { ...messagePayload, token: 'secret-token' },
      expectedToken: 'secret-token',
      hmacKey: '',
    });
    expect(result).toEqual({ ok: true });
  });
});
