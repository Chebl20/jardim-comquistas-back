import {
  isWebhookAuthorized,
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
});
