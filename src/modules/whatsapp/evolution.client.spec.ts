import { EvolutionClient, EvolutionSendTextError } from './evolution.client';

describe('EvolutionClient', () => {
  let client: EvolutionClient;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_BASE_URL = 'https://evolution.example.com';
    process.env.EVOLUTION_API_KEY = 'test-api-key';
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    client = new EvolutionClient();
  });

  it('connectInstance sends webhookUrl, subscribe and apikey header', async () => {
    await client.connectInstance({
      webhookUrl: 'https://api.example.com/api/evolution/webhook',
      subscribe: ['Message'],
      immediate: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/connect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          webhookUrl: 'https://api.example.com/api/evolution/webhook',
          subscribe: ['Message'],
          immediate: false,
        }),
      }),
    );
  });

  it('getStatus uses GET with apikey header', async () => {
    await client.getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ apikey: 'test-api-key' }),
      }),
    );
  });

  it('sends text to /send/text with number and text fields', async () => {
    await client.sendText('559882066740', 'Olá!');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/send/text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '559882066740',
          text: 'Olá!',
        }),
      }),
    );
  });

  it('sends quoted reply using messageId and participant', async () => {
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
      'https://evolution.example.com/send/text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '28089136451755@lid',
          text: 'resposta',
          quoted: {
            messageId: '3EB0FB259FC408FC71E7AE',
            participant: '28089136451755:89@lid',
          },
        }),
      }),
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
    } satisfies Partial<EvolutionSendTextError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries plain send after quoted reply fails (non-terminal)', async () => {
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
    expect(bodies.map((body) => body.number)).toEqual([
      '28089136451755@lid',
      '28089136451755@lid',
    ]);
    expect(bodies[0].quoted).toBeDefined();
    expect(bodies[1].quoted).toBeUndefined();
  });

  it('sets presence using /message/presence', async () => {
    await client.setPresence('559882066740@s.whatsapp.net', 'composing');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/message/presence',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '559882066740@s.whatsapp.net',
          state: 'composing',
        }),
      }),
    );
  });
});
