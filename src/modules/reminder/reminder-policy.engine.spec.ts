import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from './reminder-policy.engine';
import {
  REMINDER_KINDS,
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from './reminder.types';

function makeGoal(overrides: Partial<ReminderGoalRecord> = {}): ReminderGoalRecord {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Ler',
    description: 'Ler 10 páginas',
    goalType: 'Pontual',
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

  it('envia reminder operacional para meta pontual vencendo agora', () => {
    const goal = makeGoal();
    const now = DateTime.fromISO('2026-03-05T13:01:00.000Z');

    const decision = engine.evaluate({
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

  it('envia um único follow-up após janela de espera expirar', () => {
    const goal = makeGoal({
      dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
      lastReminderSentAt: '2026-03-05T13:00:00.000Z',
      silenceUntil: '2026-03-05T13:59:00.000Z',
    });
    const now = DateTime.fromISO('2026-03-05T14:05:00.000Z');

    const decision = engine.evaluate({
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

  it('não manda novo reminder durante cooldown ativo', () => {
    const goal = makeGoal({
      dailyStatus: REMINDER_STATUSES.SNOOZED,
      silenceUntil: '2026-03-05T16:00:00.000Z',
    });
    const now = DateTime.fromISO('2026-03-05T15:00:00.000Z');

    const decision = engine.evaluate({
      goal,
      now,
      timezone: 'America/Sao_Paulo',
    });

    expect(decision.action).toBe(REMINDER_POLICY_ACTIONS.WAIT);
  });

  it('troca operacional por reativação em meta contínua antiga e sem progresso', () => {
    const goal = makeGoal({
      goalType: 'Continua',
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

    const decision = engine.evaluate({
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
