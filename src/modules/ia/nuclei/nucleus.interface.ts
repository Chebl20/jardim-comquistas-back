export interface NucleusInput {
  userId: string | number;
  currentSession?: any;
  text: string;
  meta?: Record<string, unknown>;
}

export interface NucleusResult {
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
  analyze(input: NucleusInput): Promise<NucleusResult>;
}
