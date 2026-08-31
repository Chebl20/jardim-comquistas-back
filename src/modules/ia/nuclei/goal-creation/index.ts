import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { NucleusInput, Nucleus, GoalCreationMeta } from '../nucleus.interface';
import {
  FlowResult,
  ReplyAction,
  ContinueAction,
  CreateGoalAction,
  CancelAction,
  DraftGoalPayload,
  ValidatedGoalPayload,
  ScheduleConfig,
  DECISIONS,
  CLASSIFICATIONS,
  FLOW_STATES,
} from '../../conversation/flow.types';
import { formatScheduleForUser } from '../../../shared/schedule-formatter.util';
import { coerceScheduleConfig } from '../../../shared/schedule-occurrence.util';
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
function resolveReminderTime(
  value: string | null | undefined,
  now: Date,
  timezone = 'America/Sao_Paulo',
): string | null {
  if (!value) return null;

  // HH:MM — passthrough; UserGoalService converte para o dia certo
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) return value;

  const base = DateTime.fromJSDate(now).setZone(timezone);

  // ISO válido — passthrough
  const iso = DateTime.fromISO(value, { zone: timezone });
  if (iso.isValid) return iso.toUTC().toISO()!;

  // +Xmin
  const minMatch = value.match(/^\+(\d+)\s*min$/i);
  if (minMatch) {
    return base.plus({ minutes: parseInt(minMatch[1], 10) }).toUTC().toISO()!;
  }

  // +Xh (sem minutos)
  const hMatch = value.match(/^\+(\d+)\s*h$/i);
  if (hMatch) {
    return base.plus({ hours: parseInt(hMatch[1], 10) }).toUTC().toISO()!;
  }

  // +XhYmin
  const hMinMatch = value.match(/^\+(\d+)\s*h\s*(\d+)\s*min$/i);
  if (hMinMatch) {
    return base
      .plus({
        hours: parseInt(hMinMatch[1], 10),
        minutes: parseInt(hMinMatch[2], 10),
      })
      .toUTC()
      .toISO()!;
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

function parseTimeFromISO(iso: string, timezone = 'America/Sao_Paulo'): string {
  const dt = DateTime.fromISO(iso, { zone: timezone });
  if (dt.isValid) {
    return dt.setZone(timezone).toFormat('HH:mm');
  }
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return DateTime.fromJSDate(d).setZone(timezone).toFormat('HH:mm');
  }
  return iso;
}

function buildScheduleFromReminderTime(
  reminderTime: string,
  goalType: string,
  timezone = 'America/Sao_Paulo',
): ScheduleConfig {
  const isPontual = normalizeGoalType(goalType) === 'Pontual';
  if (isPontual) {
    return { type: 'once', at: reminderTime };
  }
  const timeStr = reminderTime.includes('T')
    ? parseTimeFromISO(reminderTime, timezone)
    : reminderTime;
  return { type: 'daily', times: [timeStr] };
}

function isValidScheduleConfig(sc: unknown): sc is ScheduleConfig {
  if (!sc || typeof sc !== 'object') return false;
  const o = sc as Record<string, unknown>;
  if (o.type === 'once' && typeof o.at === 'string') return true;
  if (o.type === 'daily' && Array.isArray(o.times) && o.times.length > 0) {
    if (o.durationDays !== undefined && (typeof o.durationDays !== 'number' || o.durationDays < 1))
      return false;
    return true;
  }
  if (o.type === 'weekly' && Array.isArray(o.daysOfWeek) && Array.isArray(o.times) && o.times.length > 0)
    return true;
  if (
    o.type === 'monthly' &&
    typeof o.dayOfMonth === 'number' &&
    Number.isInteger(o.dayOfMonth) &&
    o.dayOfMonth >= 1 &&
    o.dayOfMonth <= 31 &&
    Array.isArray(o.times) &&
    o.times.length > 0
  )
    return true;
  return false;
}

/**
 * Detecta se o payload está removendo dias de uma schedule semanal existente,
 * sinalizando possível confusão entre "skip today" vs "remove this day permanently"
 */
function detectSuspiciousScheduleReduction(
  meta: Record<string, unknown>,
  newSchedule: unknown,
): boolean {
  const prevSchedule = (meta.scheduleConfig as any);
  if (!prevSchedule || prevSchedule.type !== 'weekly') return false;
  
  const newSc = (newSchedule as any);
  if (!newSc || newSc.type !== 'weekly') return false;
  
  const prevDays = (Array.isArray(prevSchedule.daysOfWeek) 
    ? prevSchedule.daysOfWeek 
    : []) as number[];
  const newDays = (Array.isArray(newSc.daysOfWeek) 
    ? newSc.daysOfWeek 
    : []) as number[];
  
  // Se removeu dias (newDays é subset de prevDays com menos elementos)
  const removedDays = prevDays.filter(d => !newDays.includes(d));
  return removedDays.length > 0;
}

function sanitizeGoalPayload(
  draft: DraftGoalPayload,
  now: Date,
  meta?: Record<string, unknown>,
): GoalPayloadGuardResult {
  const title = cleanText(draft.title);
  const description = cleanText(draft.description);
  const timeToken = cleanText(draft.timeToken);
  const rawType =
    draft.scheduleConfig && typeof draft.scheduleConfig === 'object'
      ? String((draft.scheduleConfig as { type?: string }).type || '').toLowerCase()
      : '';
  const looksRecurring =
    ['daily', 'weekly', 'monthly', 'day'].includes(rawType) ||
    !!normalizeFrequency(draft.frequency);
  const normalizedGoalType =
    normalizeGoalType(typeof draft.goalType === 'string' ? draft.goalType : undefined) ??
    (looksRecurring ? 'Continua' : draft.reminderTime || draft.scheduleConfig || timeToken ? 'Pontual' : 'Continua');
  const normalizedConquest =
    normalizeConquestType(typeof draft.conquestType === 'string' ? draft.conquestType : undefined) ??
    'Mente';
  const userTimezone =
    typeof meta?.userTimezone === 'string' && meta.userTimezone.trim()
      ? meta.userTimezone.trim()
      : 'America/Sao_Paulo';

  let scheduleConfig: ScheduleConfig | undefined;
  let reminderTime: string | undefined;

  const coercedFromDraft = coerceScheduleConfig(draft.scheduleConfig, {
    reminderTime: cleanText(draft.reminderTime),
    timeToken,
    goalType: normalizedGoalType,
  });

  if (coercedFromDraft && isValidScheduleConfig(coercedFromDraft)) {
    scheduleConfig = coercedFromDraft;
    if (scheduleConfig.type === 'once') reminderTime = scheduleConfig.at;
  } else {
    let rawReminder = cleanText(draft.reminderTime) || timeToken;
    if (rawReminder) {
      const resolved = resolveReminderTime(rawReminder, now, userTimezone);
      if (!resolved) {
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
      reminderTime = resolved;
      scheduleConfig = buildScheduleFromReminderTime(
        resolved,
        normalizedGoalType,
        userTimezone,
      );
    }
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
        scheduleConfig,
      },
    };
  }

  if (!scheduleConfig && !reminderTime) {
    return {
      ok: false,
      reply:
        'A que horas você quer que eu te lembre? Pode dizer um horário (ex: 08:00) ou em quanto tempo (ex: daqui 15 min).',
      continuePayload: {
        ...draft,
        title,
        goalType: normalizedGoalType,
        conquestType: normalizedConquest,
      },
    };
  }

  const payload: ValidatedGoalPayload = {
    title,
    description: description ?? 'Primeiro gesto que deu vida ao crescimento',
    goalType: normalizedGoalType,
    conquestType: normalizedConquest,
    timeToken: timeToken ?? null,
  };

  if (reminderTime) payload.reminderTime = reminderTime;
  if (scheduleConfig) payload.scheduleConfig = scheduleConfig;

  if (normalizedGoalType === 'Continua') {
    const frequency = normalizeFrequency(draft.frequency);
    if (frequency) payload.frequency = frequency;
  }

  // 🔴 Validação: detectar confusão entre "pular hoje" vs "remover este dia permanentemente"
  if (
    meta &&
    scheduleConfig &&
    detectSuspiciousScheduleReduction(meta, scheduleConfig)
  ) {
    return {
      ok: false,
      reply:
        'Percebi que você quis remover um dia da sua agenda. Se era só para hoje não receber lembrete, eu posso pausar por umas horas em vez de remover permanentemente. Quer que eu faça isso?',
      continuePayload: draft,
    };
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

        const guardedPayload = sanitizeGoalPayload(finalPayload, now, meta);

        // 🔴 SPECIAL CASE: Detectado skip-today suspeito na turno anterior e usuário confirma agora
        // Se estava esperando confirmação para pausar e agora confirma → dismiss_goal_for_today
        if (
          meta?.suspiciousScheduleReductionDetected === true &&
          (text.toLowerCase().includes('sim') || text.toLowerCase().includes('pode') || text.toLowerCase().includes('pausar'))
        ) {
          const goalId = (meta.goalId as string | undefined);
          if (goalId) {
            const tz = (meta.timezone as string) || 'America/Sao_Paulo';
            const eodDateTime = DateTime.now().setZone(tz).endOf('day');
            const silenceUntil = eodDateTime.toJSDate();

            const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
              {
                type: 'dismiss_goal_for_today',
                payload: {
                  goalId,
                  silenceUntil,
                },
              } as any, // dismiss_goal_for_today exists in conversation-action-executor
              {
                type: 'reply',
                text: `Entendido! Vou pausar os lembretes de "${(meta.title as string) || 'sua meta'}" só para hoje. Amanhã volto a lembrar. 🌙`,
              } as ReplyAction,
            ];

            this.logger.log(`GoalCreation: returning dismiss_goal_for_today for ${goalId} until ${silenceUntil}`);
            return {
              actions,
              decision: DECISIONS.HANDLED,
              confidence: 0.95,
            };
          }
        }

        if (!guardedPayload.ok) {
          const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
            {
              type: 'continue',
              payload: {
                ...guardedPayload.continuePayload,
                // Marcar que detectamos redução suspeita para próxima turno poder executar dismiss
                ...(detectSuspiciousScheduleReduction(meta, guardedPayload.continuePayload.scheduleConfig)
                  ? { suspiciousScheduleReductionDetected: true }
                  : {}),
              },
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

        let successReply = suggestedReply || this.makeConfirmation(guardedPayload.payload);
        if (guardedPayload.payload.scheduleConfig) {
          const scheduleBlock = formatScheduleForUser(
            guardedPayload.payload.scheduleConfig,
            guardedPayload.payload.title,
            'America/Sao_Paulo',
          );
          if (scheduleBlock) {
            successReply = `${successReply}\n\n${scheduleBlock}`;
          }
        }
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

      // default continuation case (confirmação — incluir tabela para metas semanais)
      {
        let replyText = suggestedReply ?? '';
        const sc = payload?.scheduleConfig as { type?: string } | undefined;
        if (sc && (sc.type === 'weekly' || sc.type === 'daily')) {
          const scheduleBlock = formatScheduleForUser(
            payload.scheduleConfig,
            typeof payload.title === 'string' ? payload.title : undefined,
            'America/Sao_Paulo',
          );
          if (scheduleBlock) {
            replyText = `${replyText}\n\n${scheduleBlock}`;
          }
        }
        const actions: Array<ReplyAction | ContinueAction | CreateGoalAction | CancelAction> = [
          { type: 'continue', payload, to: FLOW_STATES.GOAL_CREATION } as ContinueAction,
          { type: 'reply', text: replyText } as ReplyAction,
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
