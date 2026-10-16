import { visualForConquestType } from './area-visual.util';

describe('visualForConquestType', () => {
  it('mapeia Corpo para ícone material e token do jardim', () => {
    expect(visualForConquestType('Corpo')).toEqual({
      icon: 'fitness_center',
      accentColor: 'garden-green',
    });
  });

  it('casa conquestType canônico Familia (sem acento)', () => {
    expect(visualForConquestType('Familia')).toEqual({
      icon: 'family_restroom',
      accentColor: 'accent-pink',
    });
  });

  it('casa Hobby_Lazer, não Hobby', () => {
    expect(visualForConquestType('Hobby_Lazer')).toEqual({
      icon: 'palette',
      accentColor: 'accent-pink',
    });
  });

  it('não devolve hex', () => {
    const visual = visualForConquestType('Trabalho');
    expect(visual.accentColor).toBe('accent-autumn');
    expect(visual.accentColor.startsWith('#')).toBe(false);
  });
});
