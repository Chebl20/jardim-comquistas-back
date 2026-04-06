import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus, ReminderMeta } from '../nucleus.interface';
import { FlowResult, Action, ReplyAction, FLOW_STATES, DECISIONS, CLASSIFICATIONS } from '../../conversation/flow.types';
import { ConversationAIService } from '../../conversation-ai.service';
import { REMINDER_PROMPT } from './prompt';
import { decisionFromClassification } from '../prompt-utils';
import { DateTime } from 'luxon';
import { ReminderPolicyEngine } from '../../../reminder/policy/reminder-policy.engine';
import {
  REMINDER_KINDS,
  REMINDER_STATUSES,
  ReminderKind,
} from '../../../reminder/reminder.types';
import { ReminderObservabilityService } from '../../../reminder/observability/reminder-observability.service';
import { UserGoalService } from '../../../goals/user-goal.service';

@Injectable()
export class ReminderNucleus implements Nucleus<Action> {
  private readonly logger = new Logger(ReminderNucleus.name);

  constructor(
    private readonly llm: ConversationAIService,
    private readonly policyEngine: ReminderPolicyEngine,
    private readonly observability: ReminderObservabilityService,
    private readonly userGoalService: UserGoalService,
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
    let meta = this.normalizeMeta((input.meta as ReminderMeta) || {}, text);

    // 🔴 IMPORTANTE: Garantir que temos timezone (para carregar otherGoals)
    // Se vem de CLARIFICATION, timezone pode ser undefined
    if (!meta.timezone) {
      try {
        meta.timezone = await this.userGoalService.getUserTimezone(input.userId);
        this.logger.debug(`ReminderNucleus: carregou timezone "${meta.timezone}" do usuário`);
      } catch (e) {
        this.logger.debug(`ReminderNucleus: não conseguiu carregar timezone do usuário`, e);
      }
    }

    // Carregar otherGoals para dar contexto ao LLM
    if (text && meta.timezone) {
      if (meta.pendingGoalIds && meta.pendingGoalIds.length > 0) {
        const goals = await this.userGoalService.getGoalsByIds(meta.pendingGoalIds);
        meta = { ...meta, otherGoals: goals.map((g: any) => ({ id: g.id, title: g.title })) };
      } else {
        const goalsWithStatus = await this.userGoalService.getGoalsForTodayWithStatus(
          input.userId,
          meta.timezone,
        );
        meta = { ...meta, otherGoals: goalsWithStatus.map((g) => ({ id: g.id, title: g.title })) };
      }
      this.logger.debug(`ReminderNucleus: carregou ${meta.otherGoals?.length || 0} metas para contexto`);
    }

    try {
      const prompt = REMINDER_PROMPT(
        input.currentSession || FLOW_STATES.CLARIFICATION,
        meta,
      );

      const llmRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: meta,
          userMessage: text,
        },
        prompt,
      );
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

      const goalsCompleted = llmRes.goalsCompleted as Array<{ id: string; title?: string; description?: string }> | undefined;
      let dismissGoalId = llmRes.dismissGoalId as string | undefined;

      // 🔴 Validar dismissGoalId — pode ser ID ou título (extraído do LLM)
      if (dismissGoalId) {
        const validGoalIds = [
          meta.goalId,
          ...(Array.isArray(meta.otherGoals) ? meta.otherGoals.map((g: any) => g.id) : []),
        ].filter((id) => id != null); // remover nulls

        // Primeira tentativa: é um ID válido?
        if (!validGoalIds.includes(dismissGoalId)) {
          // Tenta matching por título (o LLM pode ter extraído o título)
          const matchedGoal = Array.isArray(meta.otherGoals)
            ? meta.otherGoals.find((g: any) => g.title?.toLowerCase() === dismissGoalId?.toLowerCase())
            : null;

          if (matchedGoal?.id) {
            this.logger.debug(
              `ReminderNucleus: dismissGoalId "${dismissGoalId}" é título. Mapeado para ID: ${matchedGoal.id}`,
            );
            dismissGoalId = matchedGoal.id;
          } else {
            this.logger.warn(
              `ReminderNucleus: dismissGoalId "${dismissGoalId}" não é ID válido nem título reconhecido. Valid IDs: ${JSON.stringify(validGoalIds)}, Valid titles: ${Array.isArray(meta.otherGoals) ? meta.otherGoals.map((g: any) => g.title).join(', ') : 'none'}`,
            );

            // Fallback: usar meta.goalId se estamos respondendo a um lembrete específico
            if (meta.goalId && validGoalIds.includes(meta.goalId)) {
              dismissGoalId = meta.goalId;
              this.logger.debug(`ReminderNucleus: usando meta.goalId como fallback: ${meta.goalId}`);
            } else {
              // Não conseguimos identificar qual meta
              const goalList = Array.isArray(meta.otherGoals)
                ? meta.otherGoals.map((g: any) => `"${g.title}"`).join(', ')
                : 'nenhuma';
              return {
                actions: [
                  {
                    type: 'reply' as const,
                    text: `Desculpe, não consegui identificar qual meta você quer pausar. Suas metas disponíveis: ${goalList}.`,
                  } as ReplyAction,
                ],
                decision: DECISIONS.HANDLED,
                confidence: 0.3,
              };
            }
          }
        }
      }

      if (goalsCompleted && goalsCompleted.length > 0) {
        const goals = goalsCompleted.map((g) => ({
          id: g.id,
          title: g.title ?? meta.otherGoals?.find((og) => og.id === g.id)?.title ?? 'Progresso',
          description: g.description ?? 'Progresso concluído',
        }));
        actions.push({
          type: 'mark_multiple_done',
          payload: { goals, userMessage: text || undefined },
        });
        for (const g of goals) {
          const gid = g.id;
          actions.push({
            type: 'update_reminder',
            payload: {
              goalId: gid,
              dailyStatus: REMINDER_STATUSES.DONE,
              silenceUntil: null,
            },
          });
        }
        actions.push({
          type: 'update_reminder',
          payload: { goalId: meta.goalId!, clearSession: true },
        });
      } else if (dismissGoalId) {
        const tz = meta.timezone || 'America/Sao_Paulo';
        const endOfDay = this.policyEngine.resolveEndOfDay(tz).toISOString();
        actions.push({
          type: 'dismiss_goal_for_today',
          payload: {
            goalId: dismissGoalId,
            silenceUntil: endOfDay,
          },
        });
        if (meta.goalId === dismissGoalId) {
          actions.push({
            type: 'update_reminder',
            payload: { goalId: dismissGoalId, clearSession: true },
          });
        }
      } else if (classification === CLASSIFICATIONS.DONE && meta.goalId) {
        actions.push({
          type: 'mark_done',
          payload: {
            goalId: String(meta.goalId || ''),
            goalTitle: String(meta.goalTitle || ''),
            goalType: meta.goalType,
            userMessage: text || undefined,
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
