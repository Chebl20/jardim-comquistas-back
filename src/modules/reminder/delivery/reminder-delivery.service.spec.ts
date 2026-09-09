import { ReminderDeliveryService } from './reminder-delivery.service';
import { REMINDER_KINDS } from '../reminder.types';

describe('ReminderDeliveryService.send', () => {
  it('envia texto pronto sem Nucleus', async () => {
    const messaging = {
      hasAnyChannel: jest.fn().mockReturnValue(true),
      sendToUser: jest.fn().mockResolvedValue(true),
    };
    const observability = { delivery: jest.fn() };
    const service = new ReminderDeliveryService(
      messaging as any,
      observability as any,
    );

    const ok = await service.send({
      user: { telegramId: '1' },
      text: 'hora de ler',
      kind: REMINDER_KINDS.OPERATIONAL,
      goalId: 'g1',
      userId: 'u1',
    });

    expect(ok).toBe(true);
    expect(messaging.sendToUser).toHaveBeenCalledWith(
      { id: 'u1', telegramId: '1' },
      'hora de ler',
      'reminder',
    );
    expect(observability.delivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', goalId: 'g1' }),
    );
  });

  it('não envia sem canal', async () => {
    const messaging = {
      hasAnyChannel: jest.fn().mockReturnValue(false),
      sendToUser: jest.fn(),
    };
    const observability = { delivery: jest.fn() };
    const service = new ReminderDeliveryService(
      messaging as any,
      observability as any,
    );

    const ok = await service.send({
      user: { telegramId: null },
      text: 'x',
      kind: REMINDER_KINDS.OPERATIONAL,
      goalId: 'g1',
      userId: 'u1',
    });

    expect(ok).toBe(false);
    expect(messaging.sendToUser).not.toHaveBeenCalled();
  });
});
