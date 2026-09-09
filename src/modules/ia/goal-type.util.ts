import { GOAL_TYPES, type GoalType } from '../../domain/types/goal-type';
export { GOAL_TYPES, type GoalType } from '../../domain/types/goal-type';

export function normalizeGoalType(input?: string): GoalType | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'pontual') return 'Pontual';
  if (s === 'continua' || s === 'contínua' || s === 'continûa')
    return 'Continua';
  if (s === 'continua' || s === 'continua') return 'Continua';
  return null;
}

export default GOAL_TYPES;
