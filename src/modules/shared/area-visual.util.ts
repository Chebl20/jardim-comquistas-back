import {
  CONQUEST_TYPES,
  type ConquestType,
} from '../../domain/types/conquest-type';

export type GardenAccentColor =
  | 'garden-green'
  | 'accent-sky'
  | 'accent-pink'
  | 'accent-autumn';

export type AreaVisual = {
  icon: string;
  accentColor: GardenAccentColor;
};

const ACCENT_COLORS: readonly GardenAccentColor[] = [
  'garden-green',
  'accent-sky',
  'accent-pink',
  'accent-autumn',
];

const DEFAULT_VISUAL: AreaVisual = {
  icon: 'eco',
  accentColor: 'garden-green',
};

/** Ícones que o usuário pode escolher. O emoji acompanha o id. */
const SELECTABLE_ICONS: { id: string; emoji: string; label: string }[] = [
  { id: 'fitness_center', emoji: '🏃', label: 'Treino' },
  { id: 'psychology', emoji: '🧠', label: 'Mente' },
  { id: 'family_restroom', emoji: '👨‍👩‍👧', label: 'Família' },
  { id: 'work', emoji: '💼', label: 'Trabalho' },
  { id: 'groups', emoji: '👥', label: 'Social' },
  { id: 'attach_money', emoji: '💰', label: 'Dinheiro' },
  { id: 'self_improvement', emoji: '🙏', label: 'Calma' },
  { id: 'palette', emoji: '🎨', label: 'Lazer' },
  { id: 'eco', emoji: '🌱', label: 'Natureza' },
  { id: 'health_and_safety', emoji: '❤️', label: 'Saúde' },
];

const ICON_EMOJI: Record<string, string> = Object.fromEntries(
  SELECTABLE_ICONS.map((icon) => [icon.id, icon.emoji]),
);

const DEFAULT_EMOJI = '📌';

/** Visual canônico por conquestType. A gravação da meta usa isto. */
const CANONICAL_VISUAL: Record<ConquestType, AreaVisual> = {
  Corpo: { icon: 'fitness_center', accentColor: 'garden-green' },
  Mente: { icon: 'psychology', accentColor: 'accent-sky' },
  Familia: { icon: 'family_restroom', accentColor: 'accent-pink' },
  Trabalho: { icon: 'work', accentColor: 'accent-autumn' },
  Social: { icon: 'groups', accentColor: 'accent-pink' },
  Financeiro: { icon: 'attach_money', accentColor: 'accent-autumn' },
  Espiritual: { icon: 'self_improvement', accentColor: 'accent-sky' },
  Hobby_Lazer: { icon: 'palette', accentColor: 'accent-pink' },
};

const AREA_LABEL: Record<ConquestType, string> = {
  Corpo: 'Corpo',
  Mente: 'Mente',
  Familia: 'Família',
  Trabalho: 'Trabalho',
  Social: 'Social',
  Financeiro: 'Financeiro',
  Espiritual: 'Espiritual',
  Hobby_Lazer: 'Hobby e lazer',
};

/** Aliases que ainda aparecem no banco antigo, só para preencher a meta na leitura se a coluna vier vazia. */
const ALIAS_VISUAL: Record<string, AreaVisual> = {
  familia: CANONICAL_VISUAL.Familia,
  hobby: CANONICAL_VISUAL.Hobby_Lazer,
  lazer: CANONICAL_VISUAL.Hobby_Lazer,
  hobby_lazer: CANONICAL_VISUAL.Hobby_Lazer,
  saude: { icon: 'health_and_safety', accentColor: 'garden-green' },
};

function foldKey(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function visualForConquestType(conquestType?: string | null): AreaVisual {
  const raw = String(conquestType || '').trim();
  if (raw in CANONICAL_VISUAL) {
    return CANONICAL_VISUAL[raw as ConquestType];
  }

  const key = foldKey(raw);
  if (key in ALIAS_VISUAL) return ALIAS_VISUAL[key];

  for (const canon of CONQUEST_TYPES) {
    if (foldKey(canon) === key) return CANONICAL_VISUAL[canon];
  }

  return DEFAULT_VISUAL;
}

export function isGardenAccentColor(value: string): value is GardenAccentColor {
  return (ACCENT_COLORS as readonly string[]).includes(value);
}

export function isSelectableGoalIcon(icon: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_EMOJI, icon);
}

export function listGoalVisuals() {
  return {
    icons: SELECTABLE_ICONS,
    accentColors: [...ACCENT_COLORS],
  };
}

/**
 * Colunas da meta ganham. Sem coluna, o par do tipo — o mesmo da gravação.
 */
export function resolveStoredGoalVisual(input: {
  icon?: string | null;
  accentColor?: string | null;
  conquestType?: string | null;
}): AreaVisual {
  const fromType = visualForConquestType(input.conquestType);
  const icon = String(input.icon || '').trim();
  const accent = String(input.accentColor || '').trim();
  return {
    icon: icon || fromType.icon,
    accentColor: isGardenAccentColor(accent) ? accent : fromType.accentColor,
  };
}

export function emojiForIcon(icon?: string | null): string {
  const key = String(icon || '').trim();
  return ICON_EMOJI[key] ?? DEFAULT_EMOJI;
}

export function listConquestAreas() {
  return CONQUEST_TYPES.map((id) => {
    const visual = CANONICAL_VISUAL[id];
    return {
      id,
      name: AREA_LABEL[id],
      isActive: true,
      icon: visual.icon,
      accentColor: visual.accentColor,
    };
  });
}
