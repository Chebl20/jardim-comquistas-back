/**
 * Tipos de conquista (áreas de foco) do domínio.
 * Definição canônica — importada por goals, reminder, shared e ia.
 */
export const CONQUEST_TYPES = [
  'Corpo',
  'Mente',
  'Familia',
  'Trabalho',
  'Social',
  'Financeiro',
  'Espiritual',
  'Hobby_Lazer',
] as const;

export type ConquestType = (typeof CONQUEST_TYPES)[number];
