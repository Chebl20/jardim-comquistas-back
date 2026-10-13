import { InboundMessagePipeline } from './inbound-message-pipeline';
import { MANUAL_DIGEST_TRIGGER } from './inbound.types';
import type { InboundTransport } from './inbound.types';

function fakeTransport(): InboundTransport & {
  sent: Array<{ text: string; origin?: string }>;
  typingStarts: number;
  typingStops: number;
} {
  const t = {
    sent: [] as Array<{ text: string; origin?: string }>,
    typingStarts: 0,
    typingStops: 0,
    async send(text: string, origin?: string) {
      t.sent.push({ text, origin });
    },
    startTyping() {
      t.typingStarts += 1;
    },
    stopTyping() {
      t.typingStops += 1;
    },
  };
  return t;
}

const user = { id: 'u1', name: 'Ana' };

describe('InboundMessagePipeline', () => {
  let link: {
    getUserByTelegramId: jest.Mock;
    getUserByWhatsappId: jest.Mock;
    linkTelegram: jest.Mock;
    linkWhatsApp: jest.Mock;
    setPreferredChannel: jest.Mock;
  };
  let digest: { sendDigestForUser: jest.Mock };
  let rate: { isAllowed: jest.Mock };
  let orch: { handle: jest.Mock };
  let pipeline: InboundMessagePipeline;

  beforeEach(() => {
    link = {
      getUserByTelegramId: jest.fn(),
      getUserByWhatsappId: jest.fn(),
      linkTelegram: jest.fn(),
      linkWhatsApp: jest.fn(),
      setPreferredChannel: jest.fn().mockResolvedValue(undefined),
    };
    digest = { sendDigestForUser: jest.fn() };
    rate = { isAllowed: jest.fn().mockResolvedValue(true) };
    orch = { handle: jest.fn() };
    pipeline = new InboundMessagePipeline(
      link as any,
      digest as any,
      rate as any,
      orch as any,
    );
  });

  it('pede texto quando a mensagem não é string', async () => {
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: null,
      transport,
    });
    expect(transport.sent).toEqual([
      { text: 'Envie uma mensagem de texto.', origin: 'telegram-service' },
    ]);
    expect(link.getUserByTelegramId).not.toHaveBeenCalled();
  });

  it('vincula Telegram com código hex válido', async () => {
    link.getUserByTelegramId.mockResolvedValue(null);
    link.linkTelegram.mockResolvedValue(user);
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '99',
      text: 'abcdef12',
      transport,
    });
    expect(link.linkTelegram).toHaveBeenCalledWith('abcdef12', '99');
    expect(link.linkWhatsApp).not.toHaveBeenCalled();
    expect(transport.sent[0].text).toContain('Vinculação realizada com sucesso');
    expect(transport.sent[0].text).toContain('Ana');
  });

  it('vincula WhatsApp com código hex válido', async () => {
    link.getUserByWhatsappId.mockResolvedValue(null);
    link.linkWhatsApp.mockResolvedValue(user);
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'WHATSAPP',
      channelUserId: '5511999',
      text: 'abcdef12',
      transport,
    });
    expect(link.linkWhatsApp).toHaveBeenCalledWith('abcdef12', '5511999');
    expect(link.linkTelegram).not.toHaveBeenCalled();
  });

  it('código inválido avisa o usuário', async () => {
    link.getUserByTelegramId.mockResolvedValue(null);
    link.linkTelegram.mockRejectedValue(new Error('bad'));
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'abcdef12',
      transport,
    });
    expect(transport.sent[0].text).toContain('Código de vinculação inválido');
  });

  it('sem usuário e sem código pede o código de acesso', async () => {
    link.getUserByTelegramId.mockResolvedValue(null);
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'oi',
      transport,
    });
    expect(link.linkTelegram).not.toHaveBeenCalled();
    expect(transport.sent[0].text).toContain('código de acesso');
  });

  it('dispara digest manual e avisa se falhar', async () => {
    link.getUserByTelegramId.mockResolvedValue(user);
    digest.sendDigestForUser.mockResolvedValue(null);
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: MANUAL_DIGEST_TRIGGER,
      transport,
    });
    expect(link.setPreferredChannel).toHaveBeenCalledWith('u1', 'TELEGRAM');
    expect(digest.sendDigestForUser).toHaveBeenCalledWith('u1');
    expect(transport.sent[0].text).toContain('Não foi possível enviar o resumo');
  });

  it('engole falha do rate limiter e envia reply do orchestrator', async () => {
    link.getUserByTelegramId.mockResolvedValue(user);
    rate.isAllowed.mockRejectedValue(new Error('redis'));
    orch.handle.mockResolvedValue({
      reply: 'bora',
      origin: 'orchestrator',
    });
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'ler',
      transport,
    });
    expect(rate.isAllowed).toHaveBeenCalledWith('tg:u1', expect.any(Number), 60);
    expect(transport.sent).toEqual([
      { text: 'bora', origin: 'orchestrator' },
    ]);
    expect(transport.typingStarts).toBeGreaterThanOrEqual(1);
    expect(transport.typingStops).toBeGreaterThanOrEqual(1);
  });

  it('onAck envia mensagem intermediária', async () => {
    link.getUserByWhatsappId.mockResolvedValue(user);
    orch.handle.mockImplementation(async ({ onAck }) => {
      await onAck('ack');
      return { reply: 'fim', origin: 'orchestrator' };
    });
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'WHATSAPP',
      channelUserId: '55',
      text: 'oi',
      transport,
    });
    expect(rate.isAllowed).toHaveBeenCalledWith('wa:u1', expect.any(Number), 60);
    expect(transport.sent.map((s) => s.text)).toEqual(['ack', 'fim']);
  });

  it('envia suggestedReply de interpret', async () => {
    link.getUserByTelegramId.mockResolvedValue(user);
    orch.handle.mockResolvedValue({
      kind: 'interpret',
      result: { suggestedReply: 'sugestão', origin: 'n' },
    });
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'x',
      transport,
    });
    expect(transport.sent).toEqual([{ text: 'sugestão', origin: 'n' }]);
  });

  it('outcome null envia fallback', async () => {
    link.getUserByTelegramId.mockResolvedValue(user);
    orch.handle.mockResolvedValue(null);
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'x',
      transport,
    });
    expect(transport.sent[0].text).toContain(
      'Não consegui processar sua mensagem agora',
    );
  });

  it('orchestrator que lança vira fallback', async () => {
    link.getUserByTelegramId.mockResolvedValue(user);
    orch.handle.mockRejectedValue(new Error('boom'));
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'x',
      transport,
    });
    expect(transport.sent[0].text).toContain(
      'Não consegui processar sua mensagem agora',
    );
  });

  it('exceção fora do orchestrator envia erro genérico', async () => {
    link.getUserByTelegramId.mockRejectedValue(new Error('db'));
    const transport = fakeTransport();
    await pipeline.handleInbound({
      channel: 'TELEGRAM',
      channelUserId: '1',
      text: 'x',
      transport,
    });
    expect(transport.sent[0].text).toBe('Erro ao processar sua mensagem.');
    expect(transport.sent[0].origin).toBe('telegram-service');
  });
});
