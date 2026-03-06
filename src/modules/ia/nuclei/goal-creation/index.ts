import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus, GoalCreationMeta } from '../nucleus.interface';
import {
  FlowResult,
  ReplyAction,
  ContinueAction,
  CreateGoalAction,
  CancelAction,
  DraftGoalPayload,
  ValidatedGoalPayload,
  DECISIONS,
  CLASSIFICATIONS,
  FLOW_STATES,
} from '../../conversation/flow.types';
import { PROMPT as GOAL_PROMPT } from './prompt';
import { ConversationAIService } from '../../conversation-ai.service';
import { CommunicationService } from '../../../shared/communication.service';
import { normalizeConquestType } from '../../conquest-type.enum';
import { normalizeGoalType } from '../../goal-type.util';

/**
 * Converte offsets relativos como "+15min", "+1h", "+1h30min" para ISO 8601 absoluto.
 * Formatos aceitos como passthrough: "HH:MM" e strings ISO válidas.
 * Retorna null se o valor for irreconhecível.
 */
function resolveReminderTime(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;

  // HH:MM — passthrough; UserGoalService converte para o dia certo
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) return value;

  // ISO válido — passthrough
  const iso = new Date(value);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  // +Xmin
  const minMatch = value.match(/^\+(\d+)\s*min$/i);
  if (minMatch) {
    return new Date(now.getTime() + parseInt(minMatch[1], 10) * 60_000).toISOString();
  }

  // +Xh (sem minutos)
  const hMatch = value.match(/^\+(\d+)\s*h$/i);
  if (hMatch) {
    return new Date(now.getTime() + parseInt(hMatch[1], 10) * 3_600_000).toISOString();
  }

  // +XhYmin
  const hMinMatch = value.match(/^\+(\d+)\s*h\s*(\d+)\s*min$/i);
  if (hMinMatch) {
    const ms = (parseInt(hMinMatch[1], 10) * 3_600 + parseInt(hMinMatch[2], 10) * 60) * 1000;
    return new Date(now.getTime() + ms).toISOString();
  }

  return null;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeFrequency(value: DraftGoalPayload['frequency']): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

type GoalPayloadGuardResult =
  | {
      ok: true;
      payload: ValidatedGoalPayload;
    }
  | {
      ok: false;
      reply: string;
      continuePayload: DraftGoalPayload;
    };

function sanitizeGoalPayload(
  draft: DraftGoalPayload,
  now: Date,
): GoalPayloadGuardResult {
  const title = cleanText(draft.title);
  const description = cleanText(draft.description);
  const timeToken = cleanText(draft.timeToken);
  const normalizedGoalType =
    normalizeGoalType(typeof draft.goalType === 'string' ? draft.goalType : undefined) ??
    (draft.reminderTime || timeToken ? 'Pontual' : 'Continua');
  const normalizedConquest =
    normalizeConquestType(typeof draft.conquestType === 'string' ? draft.conquestType : undefined) ??
    'Mente';

  let reminderTime = cleanText(draft.reminderTime);
  if (reminderTime) {
    const resolvedReminderTime = resolveReminderTime(reminderTime, now);
    if (!resolvedReminderTime) {
      return {
        ok: false,
        reply:
          'Não consegui confirmar o horário desse lembrete. Pode me dizer de novo o horário ou em quanto tempo eu devo te lembrar?',
        continuePayload: {
          ...draft,
          goalType: normalizedGoalType,
          conquestType: normalizedConquest,
          reminderTime: undefined,
        },
      };
    }
    reminderTime = resolvedReminderTime;
  }

  if (!title) {
    return {
      ok: false,
      reply: 'Qual meta você quer criar exatamente?',
      continuePayload: {
        ...draft,
        goalType: normalizedGoalType,
        conquestType: normalizedConquest,
        reminderTime,
      },
    };
  }

  const payload: ValidatedGoalPayload = {
    title,
    description: description ?? `Progresso em ${title}`,
    goalType: normalizedGoalType,
    conquestType: normalizedConquest,
    timeToken: timeToken ?? null,
  };

  if (reminderTime) {
    payload.reminderTime = reminderTime;
  }

  if (normalizedGoalType === 'Continua') {
    const frequency = normalizeFrequency(draft.frequency);
    if (frequency) payload.frequency = frequency;
  }

  return {
    ok: true,
    payload,
  };
}

@Injectable()
export class GoalCreationNucleus implements Nucleus<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> {
  public static PROMPT = GOAL_PROMPT;
  private readonly logger = new Logger(GoalCreationNucleus.name);

  constructor(
    private readonly llm: ConversationAIService,
    private readonly comm: CommunicationService,
  ) {}

  private makeConfirmation(payload: ValidatedGoalPayload): string {
    const title = payload?.title ? `“${payload.title}”` : 'sua meta';
    const extra = payload?.conquestType
      ? ` (${payload.conquestType})`
      : '';
    return `Legal, ${title}${extra} registrada! Agora é só manter o foco 💪`;
  }

  async analyze(
    input: NucleusInput,
  ): Promise<
    FlowResult<
      ReplyAction | ContinueAction | CreateGoalAction | CancelAction
    >
  > {
    const text = (input.text || '').trim();
    // meta is allowed arbitrary JSON
    const meta: Record<string, unknown> = (input.meta as Record<string, unknown>) || {};

    try {
      this.logger.debug(`GoalCreation.analyze start: currentSession=${input.currentSession} text=${text} meta=${JSON.stringify(meta).slice(0,2000)}`);
      const now = new Date();
      const nowISO = now.toISOString();
      const nowFormatted = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });

      const payloadForLLM = {
        ...meta,
        recentMessages: Array.isArray(meta.recentMessages)
          ? meta.recentMessages
          : [],
        nowISO,
        nowFormatted,
      };

      const systemPromptWithContext = GOAL_PROMPT(
        input.currentSession || FLOW_STATES.CLARIFICATION,
        payloadForLLM,
      );

      const aiRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: payloadForLLM,
          userMessage: text,
        },
        systemPromptWithContext,
      );

      try {
        this.logger.debug(`GoalCreation LLM raw: ${JSON.stringify(aiRes).slice(0,2000)}`);
      } catch (e) {
        this.logger.debug('GoalCreation: failed to stringify aiRes', e);
      }

      let { classification, finished, extracted, suggestedReply } = aiRes;

      // 🔴 REGRA DE RESPONSABILIDADE
      const allowed = [CLASSIFICATIONS.CONTINUE, CLASSIFICATIONS.CANCEL];

      // if the returned classification is not one of the ones we care about,
      // the nucleus typically declines responsibility. However, if the LLM
      // indicates the flow is finished and provides a complete payload, we
      // accept it as a finished creation (defensive fallback for noisy LLM).
      const hasPayload = Boolean(extracted && extracted.payload && Object.keys((extracted.payload as Record<string, unknown>) || {}).length > 0);

      if (!(allowed as string[]).includes(classification)) {
        if (finished === true && hasPayload) {
          this.logger.warn(
            `GoalCreation: classification=${classification} but finished=true and payload present — accepting as finished (fallback)`,
          );
          // fall through to finished handling below
        } else {
          this.logger.debug(
            `GoalCreation: not my job (${classification})`,
          );

          this.logger.debug(`raw aiRes: ${JSON.stringify(aiRes)}`);

          return {
            actions: [],
            decision: DECISIONS.NOT_MY_JOB,
            confidence: aiRes.confidence,
          };
        }
      }

      // treat uncertain classification explicitly
      if (classification === CLASSIFICATIONS.UNCERTAIN) {
        // still reply but mark uncertain so orchestrator won't reroute
        const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [{ type: 'reply', text: suggestedReply } as ReplyAction];
        this.logger.debug(`GoalCreation returning UNCERTAIN actions=${JSON.stringify(actions).slice(0,1000)} confidence=${aiRes.confidence}`);
        return {
          actions,
          decision: DECISIONS.UNCERTAIN,
          confidence: aiRes.confidence,
        };
      }

      if (classification === CLASSIFICATIONS.CANCEL) {
        const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
          { type: 'cancel' } as CancelAction,
          {
            type: 'reply',
            text:
              suggestedReply ??
              'Criação de meta cancelada.',
          } as ReplyAction,
        ];
        this.logger.debug(`GoalCreation returning CANCEL actions=${JSON.stringify(actions).slice(0,1000)} confidence=${aiRes.confidence}`);
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence: aiRes.confidence,
        };
      }

      const reallyFinished = finished === true;
      let payload: DraftGoalPayload = ((extracted?.payload as DraftGoalPayload) || {});

      if (reallyFinished) {
        let finalPayload: DraftGoalPayload = { ...payload };

        const userId = String(input.userId || '');

        if (
          userId &&
          (!finalPayload.title ||
            !finalPayload.description)
        ) {
          try {
            const md =
              await this.comm.generateProgressMetadata(
                userId,
                {
                  goalTitle: String(finalPayload.title || text || ''),
                },
              );

            if (!finalPayload.title)
              finalPayload.title = md.title;

            if (!finalPayload.description)
              finalPayload.description =
                md.description;
          } catch (e) {
            this.logger.warn(
              'metadata generation failed',
              e,
            );
          }
        }

        const guardedPayload = sanitizeGoalPayload(finalPayload, now);

        if (!guardedPayload.ok) {
          const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
            {
              type: 'continue',
              payload: guardedPayload.continuePayload,
              to: FLOW_STATES.GOAL_CREATION,
            } as ContinueAction,
            {
              type: 'reply',
              text: guardedPayload.reply,
            } as ReplyAction,
          ];

          this.logger.warn(
            `GoalCreation: payload blocked before persistence; continuePayload=${JSON.stringify(guardedPayload.continuePayload).slice(0, 1000)}`,
          );

          return {
            actions,
            decision: DECISIONS.HANDLED,
            confidence: aiRes.confidence,
          };
        }

        const successReply =
          suggestedReply ||
          this.makeConfirmation(guardedPayload.payload);
        const failureReply =
          'Não consegui salvar essa meta agora. Quer que eu tente de novo com você?';

        const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
          {
            type: 'create_goal',
            payload: guardedPayload.payload,
            successReply,
            failureReply,
          } as CreateGoalAction,
        ];

        try {
          this.logger.log(`GoalCreation: returning create_goal action, payload=${JSON.stringify(guardedPayload.payload).slice(0,1000)}`);
          this.logger.debug(`GoalCreation actions=${JSON.stringify(actions).slice(0,1000)} confidence=${aiRes.confidence}`);
        } catch (e) {
          this.logger.debug('GoalCreation: failed to stringify create_goal actions for logging', e);
        }

        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence: aiRes.confidence,
        };
      }

      // default continuation case
      {
        const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
          { type: 'continue', payload, to: FLOW_STATES.GOAL_CREATION } as ContinueAction,
          { type: 'reply', text: suggestedReply } as ReplyAction,
        ];
        try {
          this.logger.debug(`GoalCreation returning CONTINUE actions=${JSON.stringify(actions).slice(0,1000)} confidence=${aiRes.confidence}`);
        } catch (e) {
          this.logger.debug('GoalCreation: failed to stringify default actions for logging', e);
        }
        for (const a of actions) {
          if ((a as any).type === 'continue' && !(a as any).to) {
            this.logger.warn('GoalCreation: default continuation has no `to` — follow-ups may be routed away');
          }
        }

        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence: aiRes.confidence,
        };
      }
    } catch (e) {
      this.logger.warn('GoalCreation LLM failed', e);

      return {
        actions: [
          {
            type: 'reply',
            text:
              'Tive dificuldade para interpretar sua meta. Pode reformular em uma frase simples?',
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }
}

export default GoalCreationNucleus;
