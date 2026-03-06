import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus, ReminderMeta } from '../nucleus.interface';
import { FlowResult, Action, FLOW_STATES, DECISIONS, CLASSIFICATIONS } from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { REMINDER_PROMPT } from './prompt';
import { decisionFromClassification } from '../prompt-utils';
import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../../../reminder/reminder-policy.engine';
import {
  REMINDER_KINDS,
  REMINDER_STATUSES,
  ReminderKind,
} from '../../../reminder/reminder.types';
import { ReminderObservabilityService } from '../../../reminder/reminder-observability.service';

@Injectable()
export class ReminderNucleus implements Nucleus<Action> {
  private readonly logger = new Logger(ReminderNucleus.name);

  constructor(
    private readonly llm: ConversationAIService,
    private readonly policyEngine: ReminderPolicyEngine,
    private readonly observability: ReminderObservabilityService,
  ) {}

  /**
   * Gera uma mensagem de lembrete usando o LLM. O objeto `input.meta`
   * pode conter chaves como `userName`, `goalTitle`, `goalType` e
   * `reminderTime`.
   */
  async analyze(
    input: NucleusInput<ReminderMeta>,
  ): Promise<FlowResult<Action>> {
    const text = (input.text || '').trim();
    const meta = this.normalizeMeta((input.meta as ReminderMeta) || {}, text);

    try {
      const prompt = REMINDER_PROMPT(
        input.currentSession || FLOW_STATES.CLARIFICATION,
        meta,
      );

      const llmRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: meta,
          userMessage: text, // not used but included for consistency
        },
        prompt,
      );
      // o serviço LLM retorna `suggestedReply` como texto final
      const message = llmRes.suggestedReply || '';
      this.logger.debug(`ReminderNucleus generated message: ${message}`);

      const classification = llmRes.classification || CLASSIFICATIONS.CONTINUE;
      const decision = decisionFromClassification(classification);

      if (decision === DECISIONS.NOT_MY_JOB) {
        this.observability.reply({
          goalId: meta.goalId,
          classification,
          decision,
        });
        return {
          actions: [],
          decision,
          confidence: llmRes.confidence,
        };
      }

      const actions: Action[] = [];
      if (message) {
        actions.push({ type: 'reply', text: message });
      }

      if (classification === CLASSIFICATIONS.DONE && meta.goalId) {
        actions.push({
          type: 'mark_done',
          payload: {
            goalId: String(meta.goalId || ''),
            goalTitle: String(meta.goalTitle || ''),
            goalDescription: String(meta.goalDescription || ''),
            goalType: meta.goalType,
          },
        });
        actions.push({
          type: 'update_reminder',
          payload: {
            goalId: String(meta.goalId),
            dailyStatus: REMINDER_STATUSES.DONE,
            silenceUntil: null,
            clearSession: true,
          },
        });
      } else if (classification === CLASSIFICATIONS.SNOOZE && meta.goalId) {
        actions.push({
          type: 'update_reminder',
          payload: {
            goalId: String(meta.goalId),
            dailyStatus: REMINDER_STATUSES.SNOOZED,
            silenceUntil: this.policyEngine
              .resolveSnoozeUntil(meta.reminderKind, DateTime.now())
              .toISOString(),
            clearSession: true,
          },
        });
      } else if (classification === CLASSIFICATIONS.DISMISS && meta.goalId) {
        actions.push({
          type: 'update_reminder',
          payload: {
            goalId: String(meta.goalId),
            dailyStatus: REMINDER_STATUSES.DISMISSED,
            silenceUntil: this.policyEngine
              .resolveDismissUntil(meta.reminderKind, DateTime.now())
              .toISOString(),
            clearSession: true,
          },
        });
      } else if (text && meta.goalId) {
        // Fechar o estado de reminder após um reply válido evita loop em mensagens futuras.
        actions.push({
          type: 'update_reminder',
          payload: {
            goalId: String(meta.goalId),
            clearSession: true,
          },
        });
      }
      this.observability.reply({
        goalId: meta.goalId,
        kind: meta.reminderKind,
        classification,
        decision,
      });

      return {
        actions,
        decision,
        confidence: llmRes.confidence,
      };
    } catch (e) {
      this.logger.warn('Reminder LLM failed', e);
      return {
        actions: [
          {
            type: 'reply',
            text: 'Hmm, não consegui criar um lembrete bonito agora — mas sua meta está na lista! 😊',
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }

  private normalizeMeta(meta: ReminderMeta, text: string): ReminderMeta {
    const reminderContext = meta.reminderContext || {};
    const reminderKind =
      meta.reminderKind ||
      reminderContext.reminderKind ||
      REMINDER_KINDS.OPERATIONAL;

    return {
      ...meta,
      userReply: meta.userReply || text || undefined,
      goalId: meta.goalId || reminderContext.pendingGoalId,
      goalTitle: meta.goalTitle || reminderContext.pendingGoalTitle,
      goalDescription:
        meta.goalDescription || reminderContext.pendingGoalDescription,
      goalType: meta.goalType || reminderContext.goalType,
      reminderTime: meta.reminderTime || reminderContext.reminderTime || undefined,
      timezone: meta.timezone || reminderContext.timezone || undefined,
      reminderKind: reminderKind as ReminderKind,
    };
  }
}

export default ReminderNucleus;
