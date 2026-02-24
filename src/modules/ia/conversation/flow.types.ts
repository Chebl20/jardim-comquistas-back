export type FlowState = 'IDLE' | 'GOAL_CREATION' | 'CLARIFICATION';

export type Action =
  | { type: 'reply'; text: string }
  | { type: 'continue'; payload?: Record<string, any> }
  | { type: 'redirect'; to: FlowState; payload?: { payload?: Record<string, any>; missing?: string[] } }
  | { type: 'create_goal'; payload: Record<string, any> }
  | { type: 'cancel' };

export type FlowResult = {
  actions: Action[];
  suggestedReply?: string;
  nucleus?: string;
};