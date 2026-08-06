import type { DateTime } from 'luxon';

export const REMINDER_KINDS = {
  OPERATIONAL: 'operational',
  FOLLOW_UP: 'follow_up',
  LAST_CHANCE: 'last_chance',
  REACTIVATION: 'reactivation',
} as const;

export type ReminderKind = typeof REMINDER_KINDS[keyof typeof REMINDER_KINDS];

export const REMINDER_POLICY_ACTIONS = {
  SEND_OPERATIONAL: 'send_operational',
  SEND_FOLLOW_UP: 'send_follow_up',
  SEND_LAST_CHANCE: 'send_last_chance',
  SEND_REACTIVATION: 'send_reactivation',
  WAIT: 'wait',
  SKIP_CYCLE: 'skip_cycle',
} as const;

export type ReminderPolicyAction =
  typeof REMINDER_POLICY_ACTIONS[keyof typeof REMINDER_POLICY_ACTIONS];

export const REMINDER_STATUSES = {
  WAITING_OPERATIONAL_REPLY: 'WAITING_OPERATIONAL_REPLY',
  WAITING_FOLLOW_UP_REPLY: 'WAITING_FOLLOW_UP_REPLY',
  WAITING_REACTIVATION_REPLY: 'WAITING_REACTIVATION_REPLY',
  DONE: 'DONE',
  MISSED: 'MISSED',
  SNOOZED: 'SNOOZED',
  DISMISSED: 'DISMISSED',
  REACTIVATION_COOLDOWN: 'REACTIVATION_COOLDOWN',
} as const;

export type ReminderStatus =
  typeof REMINDER_STATUSES[keyof typeof REMINDER_STATUSES];

/**
 * ReminderGoalRecord – flat shape usada pelo policy engine e grouping util.
 *
 * Os campos de reminder state (dailyStatus, silenceUntil, etc.) residem agora
 * na tabela GoalReminder, mas são "achatados" aqui pelo adapter `goalToLegacyRecord`
 * para não precisar mudar o contrato do policy engine.
 */
export interface ReminderGoalRecord {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  goalKind: string;
  conquestType: string;
  // Reconstruído pelo adapter a partir de GoalSchedule
  reminderTime: Date | string | null;
  scheduleConfig?: unknown;
  // Estado de dispatch – achatado a partir de GoalReminder pelo adapter
  reminderSlotsToday?: unknown;
  lastReminderSentAt: Date | string | null;
  dailyStatus: string | null;
  silenceUntil: Date | string | null;
  completed: boolean;
  reminderCount: number;
  createdAt: Date | string;
  user: {
    id: string;
    name: string;
    telegramId: string | null;
    whatsappId?: string | null;
    preferredChannel?: string | null;
    timezone: string | null;
  } | null;
  plantedTree?: {
    growthEvents?: Array<{
      createdAt: Date | string;
      progressIndex: number;
    }>;
  } | null;
}

export interface ReminderPolicyInput {
  goal: ReminderGoalRecord;
  now: DateTime;
  timezone: string;
  /** Grupo da meta (para follow-up/last chance por grupo) */
  group?: import('./grouping/reminder-group.util').ReminderGroup;
}

export interface ReminderPolicyDecision {
  action: ReminderPolicyAction;
  reason: string;
  kind?: ReminderKind;
  nextStatus?: string | null;
  silenceUntil?: Date | null;
  slotKey?: string; // para scheduleConfig: horário do slot enviado (ex: "08:00")
}

export interface ReminderSessionContext {
  reminderKind: ReminderKind;
  pendingGoalId: string;
  pendingGoalTitle: string;
  pendingGoalDescription?: string;
  goalType?: string;
  reminderTime?: string | null;
  reminderCount?: number;
  timezone?: string;
  sentAt?: string;
  /** IDs de todas as metas no batch; usado para mark_multiple_done e otherGoals */
  pendingGoalIds?: string[];
}

export interface ReminderDeliveryRequest {
  goal: ReminderGoalRecord;
  kind: ReminderKind;
  timezone: string;
  sentAt: Date;
}

export interface ReminderBatchDeliveryRequest {
  goals: ReminderGoalRecord[];
  kind: ReminderKind;
  timezone: string;
  sentAt: Date;
  userId: string;
}
