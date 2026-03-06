import type { ConquestType } from '../conquest-type.enum';
import type { GoalType } from '../goal-type.util';

// `FlowState` representa o estado atual/nícleo ativo do orquestrador.
// NÃO é a mesma coisa que `Intent` — uma `Intent` é uma intenção explícita
// que um núcleo pode sinalizar ao roteador (por exemplo: iniciar criação de meta).
export const FLOW_STATES = {
  CLARIFICATION: 'CLARIFICATION',
  GOAL_CREATION: 'GOAL_CREATION',
  REMINDER: 'REMINDER',
  GOAL_STATUS: 'GOAL_STATUS',
} as const;
export type FlowState = typeof FLOW_STATES[keyof typeof FLOW_STATES];


// ações discriminadas usadas em todo o fluxo
export interface ReplyAction {
  type: 'reply';
  text: string;
}

export interface ContinueAction {
  type: 'continue';
  payload?: Record<string, any>;
  // opcional: indica para qual `FlowState` a continuação deve ser atribuída
  to?: FlowState;
}

export interface RedirectAction {
  type: 'redirect';
  to: FlowState;
  payload?: { payload?: Record<string, any>; missing?: string[] };
}

// payload flexível produzido pelo LLM; ainda precisa de saneamento antes
// de chegar à camada de persistência.
export interface DraftGoalPayload {
  title?: string | null;
  description?: string | null;
  goalType?: GoalType | string | null;
  conquestType?: ConquestType | string | null;
  frequency?: number | string | null;
  reminderTime?: string | null;
  timeToken?: string | null;
}

// payload seguro para persistência. Depois dessa fronteira, nenhum valor
// fora dos enums oficiais deve continuar no fluxo.
export interface ValidatedGoalPayload {
  title: string;
  description: string;
  goalType: GoalType;
  conquestType: ConquestType;
  frequency?: number;
  reminderTime?: string;
  timeToken?: string | null;
}

export interface CreateUserGoalInput extends ValidatedGoalPayload {
  userId: string;
  worldId: string;
}

export interface CreateGoalAction {
  type: 'create_goal';
  payload: ValidatedGoalPayload;
  successReply: string;
  failureReply: string;
}

export interface CancelAction {
  type: 'cancel';
}

export interface MarkDoneAction {
  type: 'mark_done';
  payload: {
    goalId: string;
    goalTitle?: string;
    goalDescription?: string;
    goalType?: 'Pontual' | 'Continua';
  };
}

export interface UpdateReminderAction {
  type: 'update_reminder';
  payload: {
    goalId: string;
    dailyStatus?: string | null;
    silenceUntil?: string | null;
    clearSession?: boolean;
  };
}

// união geral de ações
export type Action =
  | ReplyAction
  | ContinueAction
  | RedirectAction
  | CreateGoalAction
  | CancelAction
  | MarkDoneAction
  | UpdateReminderAction;

// lista oficial de classificações retornáveis pelos núcleos. usar o
// `CLASSIFICATIONS` abaixo garante que os prompts e o código permaneçam
// sincronizados.
export const CLASSIFICATIONS = {
  CONTINUE: 'continue',
  CANCEL: 'cancel',
  NEW_INTENT: 'new_intent',
  SMALL_TALK: 'small_talk',
  INVALID_INPUT: 'invalid_input',
  UNCERTAIN: 'uncertain',
  DONE: 'done', // usado pelo núcleo de lembrete
  SNOOZE: 'snooze',
  DISMISS: 'dismiss',
} as const;
export type Classification = typeof CLASSIFICATIONS[keyof typeof CLASSIFICATIONS];

// intents explícitas que podem ser sinalizadas pelos núcleos ao roteador
export const INTENTS = {
  CREATE_GOAL: 'CREATE_GOAL',
  CREATE_REMINDER: 'CREATE_REMINDER',
  CHECK_GOAL_STATUS: 'CHECK_GOAL_STATUS',
  UPDATE_GOAL: 'UPDATE_GOAL',
  CANCEL_FLOW: 'CANCEL_FLOW',
  OPEN_CLARIFICATION: 'OPEN_CLARIFICATION',
} as const;
export type Intent = typeof INTENTS[keyof typeof INTENTS];

// lista oficial de decisões de domínio retornáveis pelos núcleos
export const DECISIONS = {
  HANDLED: 'handled',
  NOT_MY_JOB: 'not_my_job',
  UNCERTAIN: 'uncertain',
} as const;
export type Decision = typeof DECISIONS[keyof typeof DECISIONS];

// contrato formalizado de resultado de núcleo
export type FlowResult<A extends Action = Action> = {
  actions: A[];
  extracted?: { payload?: Record<string, any>; missing?: string[] };
  decision: Decision;
  confidence: number;
};