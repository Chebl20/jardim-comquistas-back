import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../policy/reminder-policy.engine';
import {
  REMINDER_POLICY_ACTIONS,
  REMINDER_STATUSES,
  ReminderGoalRecord,
} from '../reminder.types';
import { planUserReminders } from './plan-user-reminders';

const TZ = 'America/Sao_Paulo';

function makeDaily(
  id: string,
  times: string[],
  overrides: Partial<ReminderGoalRecord> = {},
): ReminderGoalRecord {
  return {
    id,
    userId: 'user-1',
    title: id,
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

function plan(
  userGoals: ReminderGoalRecord[],
  now: DateTime,
  cancelledGoalIds: Set<string> = new Set(),
) {
  return planUserReminders({
    userGoals,
    now,
    timezone: TZ,
    cancelledGoalIds,
    policyEngine: new ReminderPolicyEngine(),
    groupWindowMinutes: 60,
    groupFollowUpMinutes: 5,
    groupLastChanceMinutes: 15,
  });
}

describe('planUserReminders', () => {
  it('uma meta operacional due → toSend length 1, skipUpdates vazio', () => {
    const goal = makeDaily('g1', ['08:00']);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const result = plan([goal], now);
    expect(result.toSend).toHaveLength(1);
    expect(result.toSend[0].goal.id).toBe('g1');
    expect(result.toSend[0].decision.action).toBe(
      REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL,
    );
    expect(result.skipUpdates).toHaveLength(0);
  });

  it('duas operacionais due no mesmo tick → toSend length 2', () => {
    const a = makeDaily('g1', ['08:00']);
    const b = makeDaily('g2', ['08:00']);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const result = plan([a, b], now);
    expect(result.toSend).toHaveLength(2);
    expect(result.toSend.map((i) => i.goal.id).sort()).toEqual(['g1', 'g2']);
  });

  it('follow-up de grupo faz fan-out sem slotKey e não duplica', () => {
    const lastSent = '2026-03-05T13:15:00.000Z';
    const claimed = {
      occKey: '2026-03-05T10:14',
      time: '10:14',
      date: '2026-03-05',
      status: 'SENT',
    };
    const claimedB = {
      occKey: '2026-03-05T10:15',
      time: '10:15',
      date: '2026-03-05',
      status: 'SENT',
    };
    const goalA = makeDaily('goal-a', ['10:14'], {
      createdAt: '2026-02-01T12:00:00.000Z',
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: lastSent,
        slotsToday: [claimed],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const goalB = makeDaily('goal-b', ['10:15'], {
      createdAt: '2026-02-01T12:00:00.000Z',
      reminder: {
        dailyStatus: REMINDER_STATUSES.WAITING_OPERATIONAL_REPLY,
        lastSentAt: lastSent,
        slotsToday: [claimedB],
        silenceUntil: null,
        sentCount: 1,
        updatedAt: null,
      },
    });
    const now = DateTime.fromISO('2026-03-05T13:21:00.000Z');
    const result = plan([goalA, goalB], now);
    expect(result.toSend).toHaveLength(2);
    expect(result.toSend.every((i) => i.decision.slotKey === undefined)).toBe(
      true,
    );
    expect(
      result.toSend.every(
        (i) => i.decision.action === REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP,
      ),
    ).toBe(true);
    expect(new Set(result.toSend.map((i) => i.goal.id))).toEqual(
      new Set(['goal-a', 'goal-b']),
    );
  });

  it('SKIP_CYCLE entra em skipUpdates, não em toSend', () => {
    const goal = makeDaily('g1', ['08:00']);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const result = planUserReminders({
      userGoals: [goal],
      now,
      timezone: TZ,
      cancelledGoalIds: new Set(),
      policyEngine: {
        evaluate: () => ({
          action: REMINDER_POLICY_ACTIONS.SKIP_CYCLE,
          reason: 'forced_skip_for_planner',
        }),
      },
      groupWindowMinutes: 60,
      groupFollowUpMinutes: 5,
      groupLastChanceMinutes: 15,
    });
    expect(result.toSend).toHaveLength(0);
    expect(result.skipUpdates).toHaveLength(1);
    expect(result.skipUpdates[0].decision.action).toBe(
      REMINDER_POLICY_ACTIONS.SKIP_CYCLE,
    );
  });

  it('WAIT não entra em toSend nem skipUpdates; aparece em evaluations', () => {
    const goal = makeDaily('g1', ['18:00']);
    const now = DateTime.fromISO('2026-09-02T08:00:00', { zone: TZ });
    const result = plan([goal], now);
    expect(result.toSend).toHaveLength(0);
    expect(result.skipUpdates).toHaveLength(0);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].goalId).toBe('g1');
    expect(result.evaluations[0].decision.action).toBe(
      REMINDER_POLICY_ACTIONS.WAIT,
    );
  });
});
