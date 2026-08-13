import { WuzapiClient } from './wuzapi.client';

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

  it('setWebhook sends webhookURL with Token header', async () => {
    await client.setWebhook('https://api.example.com/api/wuzapi/webhook');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wuzapi.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Token: 'test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          webhookURL: 'https://api.example.com/api/wuzapi/webhook',
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
});
