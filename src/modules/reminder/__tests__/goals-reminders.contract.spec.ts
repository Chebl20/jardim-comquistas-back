import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../policy/reminder-policy.engine';
import {
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from '../reminder.types';
import { InMemoryClaimStore } from '../claim/in-memory-claim.store';
import { claimedTimesForCivilDate } from '../claim/claimed-slots.util';
import { makeOccKey } from '../../shared/occurrence-key.util';
import { occurrencesOnCivilDate } from '../../shared/schedule-occurrence.util';

const TZ = 'America/Sao_Paulo';

function makeDaily(
  times: string[],
  overrides: Partial<ReminderGoalRecord> = {},
): ReminderGoalRecord {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Água',
    description: null,
    goalKind: 'Continua',
    conquestType: 'Corpo',
    timezone: TZ,
    schedule: { type: 'daily', times },
    completed: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    user: {
      id: 'user-1',
      name: 'Ana',
      telegramId: '1',
      timezone: TZ,
    },
    plantedTree: {
      growthEvents: [
        { createdAt: '2026-09-01T12:00:00.000Z', progressIndex: 1 },
        { createdAt: '2026-09-01T18:00:00.000Z', progressIndex: 2 },
      ],
    },
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

describe('Goals + Reminders occurrence contract', () => {
  const engine = new ReminderPolicyEngine();

  it('1. Daily 08:00 dispara às 08:00', async () => {
    const goal = makeDaily(['08:00']);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const d = engine.evaluate({ goal, now, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(d.slotKey).toBe(makeOccKey('2026-09-02', '08:00'));
  });

  it('2. Mesmo slot +1 minuto não dispara de novo após claim', async () => {
    const goal = makeDaily(['08:00']);
    const store = new InMemoryClaimStore();
    store.seedFromGoal(goal);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const d1 = engine.evaluate({ goal, now, timezone: TZ });
    expect(
      await store.claimBatch([{ goal, decision: d1 }], now, TZ),
    ).toBe(true);
    const later = now.plus({ minutes: 1 });
    const d2 = engine.evaluate({ goal, now: later, timezone: TZ });
    expect(d2.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('3. Cron 08:20 ainda dispara uma vez (catch-up)', async () => {
    const goal = makeDaily(['08:00']);
    const now = DateTime.fromISO('2026-09-02T08:20:00', { zone: TZ });
    const d = engine.evaluate({ goal, now, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
  });

  it('4. Daily 08:00 + 18:00 são slots independentes', async () => {
    const goal = makeDaily(['08:00', '18:00']);
    const morning = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const d1 = engine.evaluate({ goal, now: morning, timezone: TZ });
    expect(d1.slotKey).toBe(makeOccKey('2026-09-02', '08:00'));
    const store = new InMemoryClaimStore();
    store.seedFromGoal(goal);
    await store.claimBatch([{ goal, decision: d1 }], morning, TZ);
    const evening = DateTime.fromISO('2026-09-02T18:00:00', { zone: TZ });
    const d2 = engine.evaluate({ goal, now: evening, timezone: TZ });
    expect(d2.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(d2.slotKey).toBe(makeOccKey('2026-09-02', '18:00'));
  });

  it('5. Concluir 08:00 não impede 18:00', async () => {
    const goal = makeDaily(['08:00', '18:00'], {
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: null,
        slotsToday: [
          {
            occKey: makeOccKey('2026-09-02', '08:00'),
            time: '08:00',
            date: '2026-09-02',
            status: 'DONE',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const evening = DateTime.fromISO('2026-09-02T18:00:00', { zone: TZ });
    const d = engine.evaluate({ goal, now: evening, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(d.slotKey).toBe(makeOccKey('2026-09-02', '18:00'));
  });

  it('6. MISSED ontem não bloqueia 08:00 amanhã', async () => {
    const goal = makeDaily(['08:00'], {
      reminder: {
        dailyStatus: REMINDER_STATUSES.MISSED,
        lastSentAt: null,
        slotsToday: [
          {
            occKey: makeOccKey('2026-09-01', '08:00'),
            time: '08:00',
            date: '2026-09-01',
            status: 'MISSED',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const d = engine.evaluate({ goal, now, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
  });

  it('7. Weekly segunda: terça não recebe follow-up', async () => {
    const goal = makeDaily(['08:00'], {
      schedule: { type: 'weekly', daysOfWeek: [1], times: ['08:00'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-08-31T11:00:00.000Z',
        slotsToday: [],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const tuesday = DateTime.fromISO('2026-09-01T10:00:00', { zone: TZ });
    expect(tuesday.setZone(TZ).weekday).toBe(2);
    const d = engine.evaluate({ goal, now: tuesday, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
    expect(d.reason).toBe('not_scheduled_today');
  });

  it('8. Batch com falha no segundo lock não marca o primeiro', async () => {
    const a = makeDaily(['08:00'], { id: 'a' });
    const b = makeDaily(['08:00'], {
      id: 'b',
      reminder: {
        dailyStatus: null,
        lastSentAt: '2026-09-02T11:00:00.000Z',
        slotsToday: [],
        silenceUntil: null,
        sentCount: 0,
        updatedAt: null,
      },
    });
    const store = new InMemoryClaimStore();
    store.seedFromGoal(a);
    store.seedFromGoal(b);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const decision = {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      slotKey: makeOccKey('2026-09-02', '08:00'),
    };
    const ok = await store.claimBatch(
      [
        { goal: a, decision },
        { goal: { ...b, reminder: { ...b.reminder, lastSentAt: null } }, decision },
      ],
      now,
      TZ,
    );
    expect(ok).toBe(false);
    expect(store.get('a')?.sentCount).toBe(0);
    expect(store.get('b')?.sentCount).toBe(0);
  });

  it('9. Falha de delivery → rollback do mark', async () => {
    const goal = makeDaily(['08:00']);
    const store = new InMemoryClaimStore();
    store.seedFromGoal(goal);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const snapshots = [
      {
        id: goal.id,
        dailyStatus: goal.reminder.dailyStatus,
        lastSentAt: goal.reminder.lastSentAt,
        silenceUntil: goal.reminder.silenceUntil,
        slotsToday: goal.reminder.slotsToday,
        sentCount: goal.reminder.sentCount || 0,
      },
    ];
    const decision = {
      action: REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
      reason: 'operational_due',
      nextStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      slotKey: makeOccKey('2026-09-02', '08:00'),
    };
    await store.claimBatch([{ goal, decision }], now, TZ);
    expect(store.get(goal.id)?.sentCount).toBe(1);
    await store.rollback(snapshots);
    expect(store.get(goal.id)?.sentCount).toBe(0);
    expect(store.get(goal.id)?.dailyStatus).toBeNull();
  });

  it('10. occKey usa timezone do usuário', () => {
    const goal = makeDaily(['08:00']);
    const occs = occurrencesOnCivilDate(
      {
        createdAt: new Date(goal.createdAt as string),
        schedule: goal.schedule,
      },
      DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ }),
      TZ,
    );
    expect(occs[0].civilDate).toBe('2026-09-02');
    expect(occs[0].hhmm).toBe('08:00');
  });

  it('11. SKIPPED + silêncio até fim do dia civil espera', async () => {
    const now = DateTime.fromISO('2026-09-02T10:00:00', { zone: TZ });
    const goal = makeDaily(['18:00'], {
      reminder: {
        dailyStatus: REMINDER_STATUSES.SKIPPED,
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: now.endOf('day').toJSDate(),
        sentCount: 0,
        updatedAt: null,
      },
    });
    const d = engine.evaluate({ goal, now, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('12. DONE pontual no status (máquina: ocorrência DONE + completed no write)', async () => {
    const goal = makeDaily(['08:00'], {
      goalKind: 'Pontual',
      schedule: { type: 'once', at: '2026-09-02T08:00:00.000-03:00' },
      reminder: {
        dailyStatus: REMINDER_STATUSES.DONE,
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: '2026-09-02T08:05:00.000-03:00',
      },
      completed: true,
    });
    const now = DateTime.fromISO('2026-09-02T09:00:00', { zone: TZ });
    const d = engine.evaluate({ goal, now, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('13. follow-up sem slotKey não bloqueia 18:00', async () => {
    const goal = makeDaily(['08:00', '18:00'], {
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: null,
        slotsToday: [
          {
            occKey: makeOccKey('2026-09-02', '08:00'),
            time: '08:00',
            date: '2026-09-02',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const store = new InMemoryClaimStore();
    store.seedFromGoal(goal);
    const followAt = DateTime.fromISO('2026-09-02T08:10:00', { zone: TZ });
    const follow = {
      action: REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP,
      reason: 'follow_up_due',
      nextStatus: REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
    };
    expect(await store.claimBatch([{ goal, decision: follow }], followAt, TZ)).toBe(
      true,
    );
    const evening = DateTime.fromISO('2026-09-02T18:00:00', { zone: TZ });
    const afterClaim = {
      ...goal,
      reminder: {
        ...goal.reminder,
        dailyStatus: store.get(goal.id)?.dailyStatus ?? goal.reminder.dailyStatus,
        slotsToday: store.get(goal.id)?.slotsToday,
        lastSentAt: store.get(goal.id)?.lastSentAt ?? null,
      },
    };
    const d = engine.evaluate({ goal: afterClaim, now: evening, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(d.slotKey).toBe(makeOccKey('2026-09-02', '18:00'));
  });

  it('14. WAITING_FOLLOW_UP_REPLY não engole o 18:00', async () => {
    const goal = makeDaily(['08:00', '18:00'], {
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
        lastSentAt: '2026-09-02T08:10:00.000-03:00',
        slotsToday: [
          {
            occKey: makeOccKey('2026-09-02', '08:00'),
            time: '08:00',
            date: '2026-09-02',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 2,
        updatedAt: null,
      },
    });
    const evening = DateTime.fromISO('2026-09-02T18:00:00', { zone: TZ });
    const d = engine.evaluate({ goal, now: evening, timezone: TZ });
    expect(d.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(d.slotKey).toBe(makeOccKey('2026-09-02', '18:00'));
  });

  it('dual-read: legado {time} só conta se lastSentAt for o mesmo civilDate', () => {
    const sameDay = claimedTimesForCivilDate(
      [{ time: '08:00' }],
      '2026-09-02',
      {
        lastSentAt: '2026-09-02T08:01:00.000-03:00',
        timezone: TZ,
      },
    );
    expect(sameDay).toEqual(['08:00']);

    const stale = claimedTimesForCivilDate([{ time: '08:00' }], '2026-09-02', {
      lastSentAt: '2026-09-01T08:01:00.000-03:00',
      timezone: TZ,
    });
    expect(stale).toEqual([]);

    const noEvidence = claimedTimesForCivilDate(
      [{ time: '08:00' }],
      '2026-09-02',
    );
    expect(noEvidence).toEqual([]);
  });
});
