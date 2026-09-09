import { DateTime } from 'luxon';
import { ReminderService } from './reminder.service';
import { REMINDER_KINDS, REMINDER_POLICY_ACTIONS } from './reminder.types';

describe('ReminderService.sendSingle', () => {
  it('após send bem-sucedido, prima sessão; claim rollback se send falha', async () => {
    const claimStore = {
      claimBatch: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const copyBuilder = {
      composeSingle: jest.fn().mockResolvedValue({
        text: 'msg',
        userId: 'u1',
        mainGoal: { id: 'g1', title: 'Ler' },
        pendingGoalIds: ['g1'],
        reminderContext: {},
      }),
      primeSession: jest.fn().mockResolvedValue(undefined),
    };
    const delivery = { send: jest.fn().mockResolvedValue(true) };

    const service = new ReminderService(
      {} as any,
      {} as any,
      copyBuilder as any,
      delivery as any,
      {} as any,
      claimStore as any,
    );

    const goal = {
      id: 'g1',
      userId: 'u1',
      user: { telegramId: '1' },
      reminder: {
        dailyStatus: null,
        lastSentAt: null,
        silenceUntil: null,
        slotsToday: [],
        sentCount: 0,
        updatedAt: null,
      },
    };
    const now = DateTime.fromISO('2026-09-02T08:00:00', {
      zone: 'America/Sao_Paulo',
    });

    await (service as any).sendSingle(
      {
        goal,
        decision: {
          action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
          kind: REMINDER_KINDS.OPERATIONAL,
          reason: 'due',
        },
      },
      now,
      'America/Sao_Paulo',
    );

    expect(claimStore.claimBatch).toHaveBeenCalled();
    expect(copyBuilder.composeSingle).toHaveBeenCalled();
    expect(delivery.send).toHaveBeenCalled();
    expect(copyBuilder.primeSession).toHaveBeenCalled();
    expect(claimStore.rollback).not.toHaveBeenCalled();

    delivery.send.mockResolvedValue(false);
    copyBuilder.primeSession.mockClear();
    await (service as any).sendSingle(
      {
        goal,
        decision: {
          action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
          kind: REMINDER_KINDS.OPERATIONAL,
          reason: 'due',
        },
      },
      now,
      'America/Sao_Paulo',
    );
    expect(claimStore.rollback).toHaveBeenCalled();
    expect(copyBuilder.primeSession).not.toHaveBeenCalled();
  });

  it('sendBatch sem canal (delivery false) faz rollback de todos', async () => {
    const claimStore = {
      claimBatch: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const copyBuilder = {
      composeBatch: jest.fn().mockResolvedValue({
        text: 'batch',
        userId: 'u1',
        mainGoal: { id: 'g1', title: 'Ler' },
        pendingGoalIds: ['g1', 'g2'],
        reminderContext: {},
      }),
      primeSession: jest.fn().mockResolvedValue(undefined),
    };
    const delivery = { send: jest.fn().mockResolvedValue(false) };

    const service = new ReminderService(
      {} as any,
      {} as any,
      copyBuilder as any,
      delivery as any,
      {} as any,
      claimStore as any,
    );

    const base = {
      userId: 'u1',
      user: { telegramId: null, whatsappId: null },
      reminder: {
        dailyStatus: null,
        lastSentAt: null,
        silenceUntil: null,
        slotsToday: [],
        sentCount: 0,
        updatedAt: null,
      },
    };
    const now = DateTime.fromISO('2026-09-02T08:00:00', {
      zone: 'America/Sao_Paulo',
    });

    await (service as any).sendBatch(
      [
        {
          goal: { ...base, id: 'g1' },
          decision: {
            action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
            kind: REMINDER_KINDS.OPERATIONAL,
            reason: 'due',
          },
        },
        {
          goal: { ...base, id: 'g2' },
          decision: {
            action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
            kind: REMINDER_KINDS.OPERATIONAL,
            reason: 'due',
          },
        },
      ],
      now,
      'America/Sao_Paulo',
    );

    expect(claimStore.claimBatch).toHaveBeenCalled();
    expect(claimStore.rollback).toHaveBeenCalled();
    expect(copyBuilder.primeSession).not.toHaveBeenCalled();
  });
});

