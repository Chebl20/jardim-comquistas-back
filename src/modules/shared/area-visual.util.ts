import { CONQUEST_TYPES } from '../../domain/types/conquest-type';

export type GardenAccentColor =
  | 'garden-green'
  | 'accent-sky'
  | 'accent-pink'
  | 'accent-autumn';

export type AreaVisual = {
  icon: string;
  accentColor: GardenAccentColor;
};

const DEFAULT_VISUAL: AreaVisual = {
  icon: 'eco',
  accentColor: 'garden-green',
};

/** Visual canônico por conquestType que a API já devolve. */
const CANONICAL_VISUAL: Record<(typeof CONQUEST_TYPES)[number], AreaVisual> = {
  Corpo: { icon: 'fitness_center', accentColor: 'garden-green' },
  Mente: { icon: 'psychology', accentColor: 'accent-sky' },
  Familia: { icon: 'family_restroom', accentColor: 'accent-pink' },
  Trabalho: { icon: 'work', accentColor: 'accent-autumn' },
  Social: { icon: 'groups', accentColor: 'accent-pink' },
  Financeiro: { icon: 'attach_money', accentColor: 'accent-autumn' },
  Espiritual: { icon: 'self_improvement', accentColor: 'accent-sky' },
  Hobby_Lazer: { icon: 'palette', accentColor: 'accent-pink' },
};

/** Aliases que ainda aparecem no banco / front antigo. */
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
    return CANONICAL_VISUAL[raw as keyof typeof CANONICAL_VISUAL];
  }

  const key = foldKey(raw);
  if (key in ALIAS_VISUAL) return ALIAS_VISUAL[key];

  for (const canon of CONQUEST_TYPES) {
    if (foldKey(canon) === key) return CANONICAL_VISUAL[canon];
  }

  return DEFAULT_VISUAL;
}
