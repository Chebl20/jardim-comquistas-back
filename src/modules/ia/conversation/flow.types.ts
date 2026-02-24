export type FlowState = 'IDLE' | 'GOAL_CREATION' | 'CLARIFICATION' | string;

export type Action =
  | { type: 'reply'; text: string }
  | { type: 'continue'; payload?: Record<string, any> } // merge payload, mantém estado atual
  | { type: 'redirect'; to: FlowState; payload?: Record<string, any> } // muda estado
  | { type: 'create_goal'; payload: Record<string, any> } // orquestrador persiste
  | { type: 'cancel' }; // finaliza fluxo e reseta sessão

export type FlowResult = {
  actions?: Action[]; // ordem importa
  suggestedReply?: string; // fallback se não houver reply nas actions
  [k: string]: any;
};
