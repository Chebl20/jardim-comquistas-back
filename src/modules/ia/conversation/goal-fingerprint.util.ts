import { createHash } from 'crypto';
import type { ValidatedGoalPayload } from './flow.types';

export function goalFingerprint(payload: ValidatedGoalPayload): string {
  const stable = {
    title: payload.title,
    description: payload.description,
    goalType: payload.goalType,
    conquestType: payload.conquestType,
    frequency: payload.frequency ?? null,
    reminderTime: payload.reminderTime ?? null,
    scheduleConfig: payload.scheduleConfig ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function isAffirmativeConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(sim|confirmo|confirmar|pode criar|ok|isso|certo|bora)\b/.test(t);
}
