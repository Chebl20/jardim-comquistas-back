import {
  emojiForIcon,
  isSelectableGoalIcon,
  listGoalVisuals,
  resolveStoredGoalVisual,
  visualForConquestType,
} from './area-visual.util';

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

  it('coluna gravada ganha do tipo', () => {
    expect(
      resolveStoredGoalVisual({
        conquestType: 'Corpo',
        icon: 'palette',
        accentColor: 'accent-autumn',
      }),
    ).toEqual({ icon: 'palette', accentColor: 'accent-autumn' });
  });

  it('sem coluna usa o par do tipo', () => {
    expect(resolveStoredGoalVisual({ conquestType: 'Mente' })).toEqual({
      icon: 'psychology',
      accentColor: 'accent-sky',
    });
  });

  it('emoji sai do ícone, não do título', () => {
    expect(emojiForIcon('fitness_center')).toBe('🏃');
    expect(emojiForIcon('desconhecido')).toBe('📌');
  });

  it('o catálogo de edição só oferece ícones conhecidos', () => {
    const { icons, accentColors } = listGoalVisuals();
    expect(icons.map((icon) => icon.id)).toContain('psychology');
    expect(accentColors).toEqual([
      'garden-green',
      'accent-sky',
      'accent-pink',
      'accent-autumn',
    ]);
    expect(isSelectableGoalIcon('psychology')).toBe(true);
    expect(isSelectableGoalIcon('rocket_launch')).toBe(false);
  });
});
