/**
 * Tipos de meta do domínio.
 * Definição canônica — importada por goals, reminder, shared e ia.
 */
export const GOAL_TYPES = ['Pontual', 'Continua'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
