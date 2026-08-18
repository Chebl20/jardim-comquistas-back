import { WuzapiClient, WuzapiSendTextError } from './wuzapi.client';

describe('WuzapiClient', () => {
  let client: WuzapiClient;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WUZAPI_BASE_URL = 'https://wuzapi.example.com';
    process.env.WUZAPI_TOKEN = 'test-token';
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    client = new WuzapiClient();
  });

  it('setWebhook sends webhookurl and events with Token header', async () => {
    await client.setWebhook('https://api.example.com/api/wuzapi/webhook', [
      'Message',
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Token: 'test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          webhookurl: 'https://api.example.com/api/wuzapi/webhook',
          webhookURL: 'https://api.example.com/api/wuzapi/webhook',
          events: ['Message'],
        }),
      }),
    );
  });

  it('getWebhook uses GET with Token header', async () => {
    await client.getWebhook();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/webhook',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Token: 'test-token' }),
      }),
    );
  });

  it('setHmacKey sends hmac_key with Authorization header', async () => {
    const key = 'uma-chave-secreta-muito-segura-com-32-chars';
    await client.setHmacKey(key);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/session/hmac/config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ hmac_key: key }),
      }),
    );
  });

  it('connectSession sends Subscribe and Immediate', async () => {
    await client.connectSession(['Message', 'ReadReceipt'], false);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/session/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          Subscribe: ['Message', 'ReadReceipt'],
          Immediate: false,
        }),
      }),
    );
  });

  it('sends quoted reply once and does not call /user/lid', async () => {
    await client.sendTextWithTargets(
      ['28089136451755@lid', '559882066740'],
      'resposta',
      {
        replyContext: {
          stanzaId: '3EB0FB259FC408FC71E7AE',
          participant: '28089136451755:89@lid',
          quotedText: 'Quais sao as minhas metas?',
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/chat/send/text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          Phone: '28089136451755@lid',
          Body: 'resposta',
          ContextInfo: {
            StanzaID: '3EB0FB259FC408FC71E7AE',
            Participant: '28089136451755:89@lid',
          },
          QuotedText: 'Quais sao as minhas metas?',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/user/lid/'),
      expect.anything(),
    );
  });

  it('stops immediately on terminal 463 errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'error sending message: server returned error 463',
      }),
    });

    await expect(
      client.sendTextWithTargets(['28089136451755@lid', '559882066740'], 'resposta', {
        replyContext: {
          stanzaId: '3EB0FB259FC408FC71E7AE',
          participant: '28089136451755:89@lid',
          quotedText: 'Quais sao as minhas metas?',
        },
      }),
    ).rejects.toMatchObject({
      target: '28089136451755@lid',
      terminal: true,
    } satisfies Partial<WuzapiSendTextError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses one same-target fallback for non-terminal failures', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'temporary failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    await client.sendTextWithTargets(['28089136451755@lid', '559882066740'], 'resposta', {
      replyContext: {
        stanzaId: '3EB0FB259FC408FC71E7AE',
        participant: '28089136451755:89@lid',
        quotedText: 'Quais sao as minhas metas?',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.map((body) => body.Phone)).toEqual([
      '28089136451755@lid',
      '28089136451755@lid',
    ]);
    expect(bodies[0].ContextInfo).toBeDefined();
    expect(bodies[1].ContextInfo).toBeUndefined();
  });
});
