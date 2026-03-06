import { FlowState } from '../flow.types';

export interface NucleusMetaBuildContext {
  state: FlowState;
  sessionPayload: Record<string, any>;
  worldId: string;
  userId: string;
  timezone: string;
}

export interface NucleusMetaBuilder {
  supports(state: FlowState): boolean;
  build(context: NucleusMetaBuildContext): Promise<Record<string, any>>;
}
