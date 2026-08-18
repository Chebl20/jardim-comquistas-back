import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../policy/reminder-policy.engine';
import {
  REMINDER_KINDS,
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from '../reminder.types';
import type { ReminderGroup } from '../grouping/reminder-group.util';

jest.mock('../../shared/schedule-occurrence.util', () => ({
  ...jest.requireActual('../../shared/schedule-occurrence.util'),
  hasCancelledExceptionForDate: jest.fn().mockResolvedValue(false),
}));

function makeGoal(overrides: Partial<ReminderGoalRecord> = {}): ReminderGoalRecord {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Ler',
    description: 'Ler 10 páginas',
    goalKind: 'Pontual',
    conquestType: 'Mente',
    reminderTime: '2026-03-05T13:00:00.000Z',
    lastReminderSentAt: null,
    dailyStatus: null,
    silenceUntil: null,
    completed: false,
    reminderCount: 0,
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
  };
}

describe('ReminderPolicyEngine', () => {
  const engine = new ReminderPolicyEngine();

  it('envia reminder operacional para meta pontual vencendo agora', async () => {
    const goal = makeGoal();
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = await engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(decision.kind).toBe(REMINDER_KINDS.OPERATIONAL);
    expect(decision.nextStatus).toBe(
      REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
    );
  });

  it('envia reminder operacional para meta once com horário passado há 30 min', async () => {
    const goal = makeGoal({
      scheduleConfig: { type: 'once', at: '2026-03-05T16:00:00.000-03:00' },
      reminderTime: null,
      lastReminderSentAt: null,
    });
    const now = DateTime.fromISO('2026-03-05T16:31:00.000-03:00');

    const decision = await engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL);
    expect(decision.kind).toBe(REMINDER_KINDS.OPERATIONAL);
  });

  it('envia um único follow-up após janela de espera expirar', async () => {
    const goal = makeGoal({
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:00:00.000Z',
      silenceUntil: '2026-03-05T13:59:00.000Z',
    });
    const now = DateTime.fromISO('2026-03-05T14:05:00.000Z');

    const decision = await engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP);
    expect(decision.kind).toBe(REMINDER_KINDS.FOLLOW_UP);
    expect(decision.nextStatus).toBe(
      REMINDER_STATUSES.WAITING_FOLLOW_UP_REPLY,
    );
  });

  it('não manda novo reminder durante cooldown ativo', async () => {
    const goal = makeGoal({
      dailyStatus: REMINDER_STATUSES.SNOOZED,
      silenceUntil: '2026-03-05T16:00:00.000Z',
    });
    const now = DateTime.fromISO('2026-03-05T15:00:00.000Z');

    const decision = await engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('retorna WAIT para follow-up de grupo quando ainda não passou 5 min do último operacional', async () => {
    const goalA = makeGoal({
      id: 'goal-a',
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:14:00.000Z',
      scheduleConfig: { type: 'daily', times: ['10:14'] },
      reminderTime: null,
    });
    const goalB = makeGoal({
      id: 'goal-b',
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:15:00.000Z',
      scheduleConfig: { type: 'daily', times: ['10:15'] },
      reminderTime: null,
    });
    const lastOp = DateTime.fromISO('2026-03-05T13:15:00.000Z').setZone('America/Sao_Paulo');
    const group: ReminderGroup = {
      goals: [goalA, goalB],
      firstScheduledAt: DateTime.fromISO('2026-03-05T13:14:00.000Z').setZone('America/Sao_Paulo'),
      lastScheduledAt: lastOp,
      groupFollowUpAt: lastOp.plus({ minutes: 5 }),
      groupLastChanceAt: lastOp.plus({ minutes: 20 }),
    };

    const now = DateTime.fromISO('2026-03-05T13:19:00.000Z');

    const decision = await engine.evaluate({
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
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:14:00.000Z',
      scheduleConfig: { type: 'daily', times: ['10:14'] },
      reminderTime: null,
    });
    const goalB = makeGoal({
      id: 'goal-b',
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:15:00.000Z',
      scheduleConfig: { type: 'daily', times: ['10:15'] },
      reminderTime: null,
    });
    const lastOp = DateTime.fromISO('2026-03-05T13:15:00.000Z').setZone('America/Sao_Paulo');
    const group: ReminderGroup = {
      goals: [goalA, goalB],
      firstScheduledAt: DateTime.fromISO('2026-03-05T13:14:00.000Z').setZone('America/Sao_Paulo'),
      lastScheduledAt: lastOp,
      groupFollowUpAt: lastOp.plus({ minutes: 5 }),
      groupLastChanceAt: lastOp.plus({ minutes: 20 }),
    };

    const now = DateTime.fromISO('2026-03-05T13:21:00.000Z');

    const decision = await engine.evaluate({
      goal: goalA,
      now,
      timezone: 'America/Sao_Paulo',
      group,
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP);
    expect(decision.kind).toBe(REMINDER_KINDS.FOLLOW_UP);
  });

  it('troca operacional por reativação em meta contínua antiga e sem progresso', async () => {
    const goal = makeGoal({
    goalKind: 'Continua',
      reminderTime: '2026-03-05T13:00:00.000Z',
      reminderCount: 4,
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

    const decision = await engine.evaluate({
      goal,
      now,
      timezone: 'UTC',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.SEND_REACTIVATION);
    expect(decision.kind).toBe(REMINDER_KINDS.REACTIVATION);
    expect(decision.nextStatus).toBe(
      REMINDER_STATUSES.WAITING_REACTIVATION_REPLY,
    );
  });
});
