import { DateTime } from 'luxon';
import {
  expectedSlotCountForGoalOnDate,
  normalizeTimeToHHmm,
  resolveDailyStatusForDate,
  scheduledTimesForGoalOnDate,
} from './schedule-occurrence.util';

describe('scheduledTimesForGoalOnDate', () => {
  const tz = 'America/Sao_Paulo';
  const createdAt = new Date('2026-01-01T12:00:00.000Z');

  it('retorna horários normalizados para meta daily', () => {
    const day = DateTime.fromISO('2026-08-26', { zone: tz });
    const times = scheduledTimesForGoalOnDate(
      {
        createdAt,
        scheduleConfig: { type: 'daily', times: ['7:00', '18:00'] },
      },
      day,
      tz,
    );
    expect(times).toEqual(['07:00', '18:00']);
    expect(expectedSlotCountForGoalOnDate(
      { createdAt, scheduleConfig: { type: 'daily', times: ['7:00', '18:00'] } },
      day,
      tz,
    )).toBe(2);
  });

  it('retorna times em weekly apenas nos dias configurados', () => {
    const goal = {
      createdAt,
      scheduleConfig: { type: 'weekly', daysOfWeek: [3], times: ['09:30'] },
    };
    const wednesday = DateTime.fromISO('2026-08-26', { zone: tz });
    const thursday = DateTime.fromISO('2026-08-27', { zone: tz });

    expect(scheduledTimesForGoalOnDate(goal, wednesday, tz)).toEqual(['09:30']);
    expect(scheduledTimesForGoalOnDate(goal, thursday, tz)).toEqual([]);
  });

  it('retorna HH:mm de meta once no fuso do usuário', () => {
    const day = DateTime.fromISO('2026-08-26', { zone: tz });
    const times = scheduledTimesForGoalOnDate(
      {
        createdAt,
        scheduleConfig: { type: 'once', at: '2026-08-26T14:30:00.000-03:00' },
      },
      day,
      tz,
    );
    expect(times).toEqual(['14:30']);
  });

  it('retorna [] quando meta não tem ocorrência no dia', () => {
    const day = DateTime.fromISO('2026-08-26', { zone: tz });
    expect(
      scheduledTimesForGoalOnDate(
        { createdAt, scheduleConfig: { type: 'monthly', dayOfMonth: 15, times: ['10:00'] } },
        day,
        tz,
      ),
    ).toEqual([]);
  });
});

describe('normalizeTimeToHHmm', () => {
  it('normaliza horários com um dígito', () => {
    expect(normalizeTimeToHHmm('8:00')).toBe('08:00');
    expect(normalizeTimeToHHmm('08:00:00')).toBe('08:00');
  });

  it('retorna null para valor inválido', () => {
    expect(normalizeTimeToHHmm('invalid')).toBeNull();
  });
});

describe('resolveDailyStatusForDate', () => {
  const tz = 'America/Sao_Paulo';
  const now = DateTime.fromISO('2026-08-26T15:00:00', { zone: tz });

  const goalWithEvents = {
    dailyStatus: 'DONE',
    plantedTree: {
      growthEvents: [
        { createdAt: '2026-01-01T12:00:00.000Z', progressIndex: 1 },
        { createdAt: '2026-08-25T14:00:00.000-03:00', progressIndex: 2 },
      ],
    },
  };

  it('não propaga DONE do banco para o dia seguinte sem colheita', () => {
    const tomorrow = DateTime.fromISO('2026-08-27', { zone: tz });
    expect(resolveDailyStatusForDate(goalWithEvents, tomorrow, tz, now)).toBe('PENDING');
  });

  it('retorna DONE hoje quando há colheita no dia', () => {
    const today = DateTime.fromISO('2026-08-26', { zone: tz });
    const goal = {
      dailyStatus: 'DONE',
      plantedTree: {
        growthEvents: [
          { createdAt: '2026-01-01T12:00:00.000Z', progressIndex: 1 },
          { createdAt: '2026-08-26T14:00:00.000-03:00', progressIndex: 2 },
        ],
      },
    };
    expect(resolveDailyStatusForDate(goal, today, tz, now)).toBe('DONE');
  });

  it('retorna PENDING hoje se DONE no banco for de ontem', () => {
    const today = DateTime.fromISO('2026-08-26', { zone: tz });
    expect(
      resolveDailyStatusForDate(
        {
          dailyStatus: 'DONE',
          reminderUpdatedAt: '2026-08-25T20:00:00.000-03:00',
          plantedTree: { growthEvents: [{ createdAt: '2026-01-01T12:00:00.000Z', progressIndex: 1 }] },
        },
        today,
        tz,
        now,
      ),
    ).toBe('PENDING');
  });

  it('retorna DONE no passado quando há growthEvent de conclusão no dia', () => {
    const past = DateTime.fromISO('2026-08-25', { zone: tz });
    expect(resolveDailyStatusForDate(goalWithEvents, past, tz, now)).toBe('DONE');
  });

  it('retorna PENDING no passado sem progresso no dia', () => {
    const past = DateTime.fromISO('2026-08-24', { zone: tz });
    expect(resolveDailyStatusForDate(goalWithEvents, past, tz, now)).toBe('PENDING');
  });
});
