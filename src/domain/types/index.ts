/**
 * Barrel de tipos canônicos de domínio.
 * Módulos externos a ia/ devem sempre importar daqui.
 */
export type { ScheduleConfig } from './schedule-config.type';
export { isValidScheduleConfig } from './schedule-config.type';
export { CONQUEST_TYPES } from './conquest-type';
export type { ConquestType } from './conquest-type';
export { GOAL_TYPES } from './goal-type';
export type { GoalType } from './goal-type';
