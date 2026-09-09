import {
  EvolutionClient,
  EvolutionSendTextError,
  normalizeSubscribeEvents,
} from './evolution.client';

describe('normalizeSubscribeEvents', () => {
  it('converts events to uppercase', () => {
    expect(normalizeSubscribeEvents(['Message', 'ALL'])).toEqual([
      'MESSAGE',
      'ALL',
    ]);
  });
});

describe('EvolutionClient', () => {
  let client: EvolutionClient;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVOLUTION_BASE_URL = 'https://evolution.example.com';
    process.env.EVOLUTION_API_KEY = '960c26f0-607b-495e-aa64-a90f75e751fa';
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    client = new EvolutionClient();
  });

  it('connectInstance sends webhookUrl and subscribe ALL without immediate', async () => {
    await client.connectInstance({
      webhookUrl: 'https://api.example.com/api/evolution/webhook',
      subscribe: ['ALL'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/connect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: '960c26f0-607b-495e-aa64-a90f75e751fa',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          webhookUrl: 'https://api.example.com/api/evolution/webhook',
          subscribe: ['ALL'],
        }),
      }),
    );
  });

  it('connectInstance normalizes subscribe events to uppercase', async () => {
    await client.connectInstance({
      webhookUrl: 'https://api.example.com/api/evolution/webhook',
      subscribe: ['Message', 'Read_Receipt'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subscribe).toEqual(['MESSAGE', 'READ_RECEIPT']);
  });

  it('connectInstance includes immediate only when true', async () => {
    await client.connectInstance({
      webhookUrl: 'https://api.example.com/api/evolution/webhook',
      subscribe: ['ALL'],
      immediate: true,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.immediate).toBe(true);
  });

  it('getStatus uses GET with instance token in apikey header', async () => {
    await client.getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/instance/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          apikey: '960c26f0-607b-495e-aa64-a90f75e751fa',
        }),
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
      client.sendTextWithTargets(
        ['28089136451755@lid', '559882066740'],
        'resposta',
        {
          replyContext: {
            stanzaId: '3EB0FB259FC408FC71E7AE',
            participant: '28089136451755:89@lid',
            quotedText: 'Quais sao as minhas metas?',
          },
        },
      ),
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    );
    expect(bodies.map((body) => body.number)).toEqual([
      '28089136451755@lid',
      '28089136451755@lid',
    ]);
    expect(bodies[0].quoted).toBeDefined();
    expect(bodies[1].quoted).toBeUndefined();
  });

  it('sets presence using /message/presence with isAudio false', async () => {
    await client.setPresence('559882066740@s.whatsapp.net', 'composing');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.com/message/presence',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '559882066740@s.whatsapp.net',
          state: 'composing',
          isAudio: false,
        }),
      }),
    );
  });

  it('includes helpful hint on 401 errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not authorized' }),
    });

    await expect(client.getStatus()).rejects.toThrow(
      /EVOLUTION_API_KEY é o token da instância \(UUID\)/,
    );
  });
});
