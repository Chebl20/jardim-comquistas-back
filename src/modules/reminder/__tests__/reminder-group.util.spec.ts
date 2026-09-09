import { DateTime } from 'luxon';
import {
  clusterGoalsIntoGroups,
  filterGoalsForToday,
  getScheduledTimeToday,
} from '../grouping/reminder-group.util';
import type { ReminderGoalRecord } from '../reminder.types';

function makeGoal(
  overrides: Partial<ReminderGoalRecord> = {},
): ReminderGoalRecord {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Ler',
    description: '',
    goalKind: 'Continua',
    conquestType: 'Mente',
    timezone: 'America/Sao_Paulo',
    schedule: { type: 'daily', times: ['08:00'] },
    completed: false,
    createdAt: new Date().toISOString(),
    user: {
      id: 'u1',
      name: 'Test',
      telegramId: '1',
      timezone: 'America/Sao_Paulo',
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

describe('reminder-group.util', () => {
  describe('getScheduledTimeToday', () => {
    it('retorna horário para meta com scheduleConfig daily', () => {
      const goal = makeGoal({
        schedule: { type: 'daily', times: ['08:00', '12:00'] },
      });
      const result = getScheduledTimeToday(goal, 'America/Sao_Paulo');
      expect(result).not.toBeNull();
      expect(result!.hour).toBe(8);
      expect(result!.minute).toBe(0);
    });

    it('retorna próximo slot não enviado para meta com slots já enviados', () => {
      const civilDate = DateTime.now()
        .setZone('America/Sao_Paulo')
        .toISODate()!;
      const goal = makeGoal({
        schedule: { type: 'daily', times: ['08:00', '12:00'] },
        reminder: {
          dailyStatus: null,
          lastSentAt: null,
          slotsToday: [
            {
              occKey: `${civilDate}T08:00`,
              time: '08:00',
              date: civilDate,
              status: 'SENT',
            },
          ],
          silenceUntil: null,
          sentCount: 1,
          updatedAt: null,
        },
      });
      const result = getScheduledTimeToday(goal, 'America/Sao_Paulo');
      expect(result).not.toBeNull();
      expect(result!.hour).toBe(12);
      expect(result!.minute).toBe(0);
    });
  });

  describe('clusterGoalsIntoGroups', () => {
    it('agrupa metas com horários dentro da janela de 60 min', () => {
      const now = DateTime.now().setZone('America/Sao_Paulo');
      const today = now.startOf('day');

      const goalA = makeGoal({
        id: 'a',
        schedule: { type: 'daily', times: ['01:14'] },
      });
      const goalB = makeGoal({
        id: 'b',
        schedule: { type: 'daily', times: ['01:15'] },
      });
      const goalC = makeGoal({
        id: 'c',
        schedule: { type: 'daily', times: ['01:15'] },
      });

      const groups = clusterGoalsIntoGroups(
        [goalA, goalB, goalC],
        'America/Sao_Paulo',
        60,
        5,
        15,
      );

      expect(groups).toHaveLength(1);
      expect(groups[0].goals).toHaveLength(3);
      expect(
        groups[0].groupFollowUpAt.diff(groups[0].lastScheduledAt, 'minutes')
          .minutes,
      ).toBe(5);
    });

    it('separa metas em grupos diferentes quando fora da janela', () => {
      const goalA = makeGoal({
        id: 'a',
        schedule: { type: 'daily', times: ['08:00'] },
      });
      const goalB = makeGoal({
        id: 'b',
        schedule: { type: 'daily', times: ['09:30'] },
      });

      const groups = clusterGoalsIntoGroups(
        [goalA, goalB],
        'America/Sao_Paulo',
        60,
        5,
        15,
      );

      expect(groups).toHaveLength(2);
      expect(groups[0].goals).toHaveLength(1);
      expect(groups[1].goals).toHaveLength(1);
    });
  });

  describe('filterGoalsForToday', () => {
    it('inclui metas com scheduleConfig daily', async () => {
      const goal = makeGoal({
        schedule: { type: 'daily', times: ['08:00'] },
      });
      const result = await filterGoalsForToday([goal], 'America/Sao_Paulo');
      expect(result).toHaveLength(1);
    });

    it('exclui weekly fora do dia civil', async () => {
      const thursday = DateTime.fromISO('2026-08-27T10:00:00', {
        zone: 'America/Sao_Paulo',
      });
      const goal = makeGoal({
        schedule: { type: 'weekly', daysOfWeek: [3], times: ['09:30'] },
      });
      const result = await filterGoalsForToday(
        [goal],
        'America/Sao_Paulo',
        thursday,
      );
      expect(result).toHaveLength(0);
    });
  });
});
