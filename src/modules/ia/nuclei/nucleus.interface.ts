import { FlowResult, FlowState } from '../conversation/flow.types';

export interface NucleusInput {
  userId: string | number;
  currentSession: FlowState; 
  text: string;
  meta?: Record<string, unknown>;
}

export interface Nucleus {
  analyze(input: NucleusInput): Promise<FlowResult>;
}