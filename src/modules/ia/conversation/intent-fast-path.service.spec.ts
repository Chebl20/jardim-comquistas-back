import { IntentFastPathService } from './intent-fast-path.service';
import { FLOW_STATES } from './flow.types';

describe('IntentFastPathService', () => {
  const svc = new IntentFastPathService();

  it('detecta status de metas', () => {
    expect(svc.resolve('status das minhas metas')).toBe(
      FLOW_STATES.GOAL_STATUS,
    );
  });

  it('detecta progresso', () => {
    expect(svc.resolve('registrei meu treino')).toBe(
      FLOW_STATES.GOAL_PROGRESS,
    );
  });

  it('detecta criação', () => {
    expect(svc.resolve('criar meta de leitura')).toBe(
      FLOW_STATES.GOAL_CREATION,
    );
  });

  it('retorna null para texto genérico', () => {
    expect(svc.resolve('bom dia')).toBeNull();
  });
});
