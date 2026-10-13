import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../policy/reminder-policy.engine';
import {
  REMINDER_KINDS,
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from '../reminder.types';
import type { ReminderGroup } from '../grouping/reminder-group.util';

function makeGoal(
  overrides: Partial<ReminderGoalRecord> = {},
): ReminderGoalRecord {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Ler',
    description: 'Ler 10 páginas',
    goalKind: 'Pontual',
    conquestType: 'Mente',
    timezone: 'America/Sao_Paulo',
    schedule: { type: 'once', at: '2026-03-05T13:00:00.000Z' },
    completed: false,
    createdAt: '2026-02-01T13:00:00.000Z',
    user: {
      id: 'user-1',
      name: 'Gabriel',
      telegramId: '123',
      timezone: 'America/Sao_Paulo',
    },
    plantedTree: {
      growthEvents: [
        {
          createdAt: '2026-02-01T13:00:00.000Z',
          progressIndex: 1,
        },
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

describe('ReminderPolicyEngine', () => {
  const engine = new ReminderPolicyEngine();

  it('sem schedule: inelegível', async () => {
    const goal = makeGoal({ schedule: null });
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
    expect(decision.reason).toBe('goal_ineligible');
  });

  it('espera se a meta está no set de exceções canceladas do dia', async () => {
    const goal = makeGoal();
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
      cancelledGoalIds: new Set([goal.id]),
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
    expect(decision.reason).toBe('occurrence_cancelled_exception');
  });

  it('envia reminder operacional para meta once com horário passado há 30 min', async () => {
    const goal = makeGoal({
      schedule: { type: 'once', at: '2026-03-05T16:00:00.000-03:00' },
    });
    const now = DateTime.fromISO('2026-03-05T16:31:00.000-03:00');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(decision.kind).toBe(REMINDER_KINDS.OPERATIONAL);
  });

  it('DONE de ontem não bloqueia lembrete no dia seguinte', async () => {
    const goal = makeGoal({
      goalKind: 'Continua',
      schedule: { type: 'daily', times: ['07:00'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.DONE,
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: null,
        sentCount: 0,
        updatedAt: '2026-08-26T18:00:00.000-03:00',
      },
      plantedTree: {
        growthEvents: [
          { createdAt: '2026-02-01T13:00:00.000Z', progressIndex: 1 },
          { createdAt: '2026-08-26T18:00:00.000-03:00', progressIndex: 2 },
        ],
      },
    });
    const now = DateTime.fromISO('2026-08-27T07:01:00.000-03:00');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
  });

  it('envia um único follow-up após janela de espera expirar', async () => {
    const goal = makeGoal({
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-03-05T13:00:00.000Z',
        slotsToday: [
          {
            occKey: '2026-03-05T10:00',
            time: '10:00',
            date: '2026-03-05',
            status: 'SENT',
          },
        ],
        silenceUntil: '2026-03-05T13:59:00.000Z',
        sentCount: 1,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-03-05T14:05:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP);
    expect(decision.kind).toBe(REMINDER_KINDS.FOLLOW_UP);
    expect(decision.nextStatus).toBe(REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY);
  });

  it('não emite follow-up se o último operacional não for do civilDate de hoje', async () => {
    const goal = makeGoal({
      goalKind: 'Continua',
      schedule: { type: 'daily', times: ['08:00'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-09-01T11:00:00.000-03:00',
        slotsToday: [{ time: '08:00' }],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-09-02T07:00:00.000-03:00');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
    expect(decision.reason).toBe('follow_up_not_same_civil_date');
  });

  it('não manda novo reminder durante cooldown ativo', async () => {
    const goal = makeGoal({
      reminder: {
        dailyStatus: REMINDER_STATUSES.SNOOZED,
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: '2026-03-05T16:00:00.000Z',
        sentCount: 0,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-03-05T15:00:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('retorna WAIT para follow-up de grupo quando ainda não passou 5 min do último operacional', async () => {
    const goalA = makeGoal({
      id: 'goal-a',
      schedule: { type: 'daily', times: ['10:14'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-03-05T13:14:00.000Z',
        slotsToday: [
          {
            occKey: '2026-03-05T10:14',
            time: '10:14',
            date: '2026-03-05',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const goalB = makeGoal({
      id: 'goal-b',
      schedule: { type: 'daily', times: ['10:15'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-03-05T13:15:00.000Z',
        slotsToday: [
          {
            occKey: '2026-03-05T10:15',
            time: '10:15',
            date: '2026-03-05',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const lastOp = DateTime.fromISO('2026-03-05T13:15:00.000Z').setZone(
      'America/Sao_Paulo',
    );
    const group: ReminderGroup = {
      goals: [goalA, goalB],
      firstScheduledAt: DateTime.fromISO('2026-03-05T13:14:00.000Z').setZone(
        'America/Sao_Paulo',
      ),
      lastScheduledAt: lastOp,
      groupFollowUpAt: lastOp.plus({ minutes: 5 }),
      groupLastChanceAt: lastOp.plus({ minutes: 20 }),
    };

    const now = DateTime.fromISO('2026-03-05T13:19:00.000Z');

    const decision = engine.evaluate({
      goal: goalA,
      now,
      timezone: 'America/Sao_Paulo',
      group,
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
    expect(decision.reason).toBe('group_follow_up_not_due');
  });

  it('envia follow-up de grupo quando passou 5 min do último operacional', async () => {
    const goalA = makeGoal({
      id: 'goal-a',
      schedule: { type: 'daily', times: ['10:14'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-03-05T13:14:00.000Z',
        slotsToday: [
          {
            occKey: '2026-03-05T10:14',
            time: '10:14',
            date: '2026-03-05',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const goalB = makeGoal({
      id: 'goal-b',
      schedule: { type: 'daily', times: ['10:15'] },
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: '2026-03-05T13:15:00.000Z',
        slotsToday: [
          {
            occKey: '2026-03-05T10:15',
            time: '10:15',
            date: '2026-03-05',
            status: 'SENT',
          },
        ],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const lastOp = DateTime.fromISO('2026-03-05T13:15:00.000Z').setZone(
      'America/Sao_Paulo',
    );
    const group: ReminderGroup = {
      goals: [goalA, goalB],
      firstScheduledAt: DateTime.fromISO('2026-03-05T13:14:00.000Z').setZone(
        'America/Sao_Paulo',
      ),
      lastScheduledAt: lastOp,
      groupFollowUpAt: lastOp.plus({ minutes: 5 }),
      groupLastChanceAt: lastOp.plus({ minutes: 20 }),
    };

    const now = DateTime.fromISO('2026-03-05T13:21:00.000Z');

    const decision = engine.evaluate({
      goal: goalA,
      now,
      timezone: 'America/Sao_Paulo',
      group,
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP);
    expect(decision.kind).toBe(REMINDER_KINDS.FOLLOW_UP);
  });

  it('não troca operacional por reativação no caminho do cron', async () => {
    const goal = makeGoal({
      goalKind: 'Continua',
      schedule: { type: 'once', at: '2026-03-05T13:00:00.000Z' },
      reminder: {
        dailyStatus: null,
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: null,
        sentCount: 4,
        updatedAt: null,
      },
      createdAt: '2026-01-01T13:00:00.000Z',
      plantedTree: {
        growthEvents: [
          {
            createdAt: '2026-01-01T13:00:00.000Z',
            progressIndex: 1,
          },
        ],
      },
    });
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'UTC',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(decision.kind).toBe(REMINDER_KINDS.OPERATIONAL);
    expect(decision.nextStatus).toBe(
      REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
    );
  });

  it('status legado de reativação não bloqueia operacional due', () => {
    const goal = makeGoal({
      goalKind: 'Continua',
      schedule: { type: 'daily', times: ['13:00'] },
      reminder: {
        dailyStatus: 'WAITING_REACTIVATION_REPLY',
        lastSentAt: null,
        slotsToday: [],
        silenceUntil: null,
        sentCount: 0,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'UTC',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(decision.kind).toBe(REMINDER_KINDS.OPERATIONAL);
  });
});
