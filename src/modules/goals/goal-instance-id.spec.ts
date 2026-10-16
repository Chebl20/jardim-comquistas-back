import {
  buildGoalInstanceId,
  parseGoalInstanceId,
} from './goal-instance-id';

describe('goal-instance-id', () => {
  it('monta e parseia {goalId}:{date}:{startTime}', () => {
    const id = buildGoalInstanceId(
      '70df550e-9b35-4e4f-8de4-cdf1692d698b',
      '2026-10-15',
      '08:00',
    );
    expect(id).toBe(
      '70df550e-9b35-4e4f-8de4-cdf1692d698b:2026-10-15:08:00',
    );
    expect(parseGoalInstanceId(id)).toEqual({
      goalId: '70df550e-9b35-4e4f-8de4-cdf1692d698b',
      date: '2026-10-15',
      startTime: '08:00',
    });
  });

  it('aceita instanceId URL-encoded', () => {
    expect(
      parseGoalInstanceId(
        encodeURIComponent(
          '70df550e-9b35-4e4f-8de4-cdf1692d698b:2026-10-15:18:30',
        ),
      ),
    ).toEqual({
      goalId: '70df550e-9b35-4e4f-8de4-cdf1692d698b',
      date: '2026-10-15',
      startTime: '18:30',
    });
  });

  it('aceita goalId UUID isolado (legado)', () => {
    expect(
      parseGoalInstanceId('70df550e-9b35-4e4f-8de4-cdf1692d698b'),
    ).toEqual({
      goalId: '70df550e-9b35-4e4f-8de4-cdf1692d698b',
      date: null,
      startTime: null,
    });
  });

  it('rejeita string inválida', () => {
    expect(parseGoalInstanceId('not-an-id')).toBeNull();
  });
});
