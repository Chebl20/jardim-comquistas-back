import { DateTime } from 'luxon';
import { prisma } from '../../../prisma/client';
import { PrismaClaimStore } from './prisma-claim.store';
import {
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from '../reminder.types';
import { makeOccKey } from '../../shared/occurrence-key.util';

jest.mock('../../../prisma/client', () => ({
  prisma: {
    $transaction: jest.fn(),
    goalReminder: {
      updateMany: jest.fn(),
    },
  },
}));

const TZ = 'America/Sao_Paulo';

function goal(overrides: Partial<ReminderGoalRecord> = {}): ReminderGoalRecord {
  return {
    id: 'g1',
    userId: 'u1',
    title: 'Água',
    description: null,
    goalKind: 'Continua',
    conquestType: 'Corpo',
    timezone: TZ,
    schedule: { type: 'daily', times: ['08:00'] },
    completed: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    user: {
      id: 'u1',
      name: 'Ana',
      telegramId: '1',
      timezone: TZ,
    },
    plantedTree: null,
    ...overrides,
    reminder: {
      dailyStatus: null,
      lastSentAt: null,
      slotsToday: [],
      silenceUntil: null,
      sentCount: 0,
      updatedAt: null,
      ...overrides.reminder,
    },
  };
}

describe('PrismaClaimStore', () => {
  const store = new PrismaClaimStore();
  const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
  const decision = {
    action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
    reason: 'operational_due',
    nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
    slotKey: makeOccKey('2026-09-02', '08:00'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lock com dailyStatus null: where inclui null e marca um row', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({ goalReminder: { updateMany } }),
    );

    const g = goal();
    const ok = await store.claimBatch([{ goal: g, decision }], now, TZ);
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          goalId: 'g1',
          lastSentAt: { equals: null },
          dailyStatus: { equals: null },
        }),
      }),
    );
  });

  it('batch: segunda lock falha → transação aborta (nenhuma persistida)', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({ goalReminder: { updateMany } }),
    );

    const a = goal({ id: 'a' });
    const b = goal({ id: 'b' });
    const ok = await store.claimBatch(
      [
        { goal: a, decision },
        { goal: b, decision },
      ],
      now,
      TZ,
    );
    expect(ok).toBe(false);
  });

  it('follow-up sem slotKey não grava slotsToday', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({ goalReminder: { updateMany } }),
    );

    const existing = [
      {
        occKey: makeOccKey('2026-09-02', '08:00'),
        time: '08:00',
        date: '2026-09-02',
        status: 'SENT',
      },
    ];
    const g = goal({
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: null,
        slotsToday: existing,
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const followUp = {
      action: REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP,
      reason: 'follow_up_due',
      nextStatus: REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
    };
    const ok = await store.claimBatch([{ goal: g, decision: followUp }], now, TZ);
    expect(ok).toBe(true);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.slotsToday).toBeUndefined();
    expect(g.reminder.slotsToday).toEqual(existing);
  });
});
