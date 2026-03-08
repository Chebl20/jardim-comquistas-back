import { FlowResult, FlowState, Action } from '../conversation/flow.types';
import type { ReminderKind } from '../../reminder/reminder.types';

// Shape base do input que todo núcleo recebe
export interface NucleusInput<M = Record<string, unknown>> {
  userId: string;
  currentSession: FlowState;
  text: string;
  meta?: M;
}

// Contrato que todos os núcleos devem implementar
export interface Nucleus<A extends Action = Action> {
  analyze(input: NucleusInput<any>): Promise<FlowResult<A>>;
}

// ---------------------------------------------------------------------------
// Tipos de meta específicos por núcleo
// Usados para substituir os casts `as any` e garantir segurança de tipos.
// ---------------------------------------------------------------------------

export interface RecentMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface GoalCreationMeta {
  recentMessages?: RecentMessage[];
  [key: string]: unknown;
}

export interface GoalStatusMeta {
  userGoalsSummary?: unknown[];
  worldId?: string;
  totalGoals?: number;
  _fullUserGoalsAvailable?: boolean;
  recentMessages?: RecentMessage[];
  [key: string]: unknown;
}

export interface ReminderMeta {
  goalId?: string;
  goalTitle?: string;
  goalDescription?: string;
  goalType?: 'Pontual' | 'Continua';
  reminderTime?: string;
  reminderCount?: number;
  pendingCount?: number;
  doneCount?: number;
  totalCount?: number;
  userName?: string;
  userReply?: string;
  reminderKind?: ReminderKind;
  inactivityDays?: number;
  lastProgressAt?: string;
  goalCreatedAt?: string;
  timezone?: string;
  otherGoals?: Array<{ id: string; title: string }>;
  pendingGoalIds?: string[];
  reminderContext?: {
    reminderKind?: ReminderKind;
    pendingGoalId?: string;
    pendingGoalTitle?: string;
    pendingGoalDescription?: string;
    goalType?: 'Pontual' | 'Continua';
    reminderTime?: string | null;
    timezone?: string;
  };
  previousReminders?: Array<{ sentAt: string; status: string }>;
}
