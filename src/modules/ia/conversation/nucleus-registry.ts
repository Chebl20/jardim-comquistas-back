import { FlowState } from './flow.types';
import { ClarificationNucleus } from '../nuclei/clarification';
import { GoalCreationNucleus } from '../nuclei/goal-creation';
import { GoalStatusNucleus } from '../nuclei/goal-status';
import { GoalProgressNucleus } from '../nuclei/goal-progress';
import { ReminderNucleus } from '../nuclei/reminder';

// registry maps each valid FlowState to a nucleus constructor (for validation)
export const nucleusRegistry: Record<FlowState, any> = {
  CLARIFICATION: ClarificationNucleus,
  GOAL_CREATION: GoalCreationNucleus,
  REMINDER: ReminderNucleus,
  GOAL_STATUS: GoalStatusNucleus,
  GOAL_PROGRESS: GoalProgressNucleus,
};
