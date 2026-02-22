import { Injectable } from '@nestjs/common';
import { NucleusInput } from '../nuclei/nucleus.interface';
import { ConversationAIService } from '../conversation-ai.service';
import { PROMPT as INTERPRETER_PROMPT } from '../nuclei/interpreter/prompt';

export interface IntentResult {
  type: 'continue' | 'cancel' | 'new_intent' | 'small_talk' | 'invalid_input';
  confidence: number;
}

@Injectable()
export class IntentNucleus {
  // Lightweight rule-based intent detector. Keep it small and deterministic.
  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<IntentResult> {
    const text = (input.text || '').toString().trim();

    // quick deterministic cancel detector
    if (/^\s*(cancelar|cancel|c|nao|não|abort|stop)\b/i.test(text)) return { type: 'cancel', confidence: 0.98 };

    // time-only patterns -> continue (handled by domain nuclei)
    if (/^\s*\d{1,2}(:\d{2})?\s*(h|hs|horas?)?\s*$/i.test(text)) return { type: 'continue', confidence: 0.85 };

    // Delegate to LLM for robust classification (handles typos, varied phrasing, small talk, etc.)
    try {
      const res = await this.llm.analyze({ currentState: input.currentSession as any || 'IDLE', payload: input.meta || {}, userMessage: text }, INTERPRETER_PROMPT);
      // Map ConversationAIResult.type to IntentResult.type when possible
      const mapping: Record<string, IntentResult['type']> = {
        continue: 'continue',
        cancel: 'cancel',
        new_intent: 'new_intent',
        newintent: 'new_intent',
        small_talk: 'small_talk',
        invalid_input: 'invalid_input',
        emotional: 'invalid_input',
        uncertain: 'invalid_input',
      } as any;
      const t = mapping[String(res.type)] || (res.type as any) || 'continue';
      const confidence = Math.max(0, Math.min(1, Number(res.confidence || 0)));
      return { type: t, confidence };
    } catch (e) {
      // fallback
      return { type: 'continue', confidence: 0.6 };
    }
  }
}

export default IntentNucleus;
