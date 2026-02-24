import { FlowResult } from '../conversation/flow.types';

export interface NucleusInput {
  userId: string | number;
  currentSession?: any;
  text: string;
  meta?: Record<string, unknown>;
}

// Legacy result kept for migration compatibility
export interface NucleusResultLegacy {
  action?: string;
  confidence: number; // 0.0 - 1.0
  extracted?: any;
  suggestedReply?: string;
  stopPropagation?: boolean;
  finished?: boolean;
  delegate?: string;
  classification?: string;
  intent?: string;
  // Each nucleus must declare its name so orchestrator avoids hardcoded strings
  nucleus?: string;
}

export interface Nucleus {
  // New preferred return type is FlowResult (actions[]). For gradual migration
  // allow returning either FlowResult or the legacy NucleusResultLegacy.
  analyze(input: NucleusInput): Promise<FlowResult | NucleusResultLegacy>;
}
