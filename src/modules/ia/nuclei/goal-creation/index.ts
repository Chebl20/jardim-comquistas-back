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
  DECISIONS,
  CLASSIFICATIONS,
  FLOW_STATES,
} from '../../conversation/flow.types';
import { formatScheduleForUser } from '../../../shared/schedule-formatter.util';
import { PROMPT as GOAL_PROMPT } from './prompt';
import { ConversationAIService } from '../../conversation-ai.service';
import { CommunicationService } from '../../../shared/communication.service';
import {
  sanitizeGoalPayload,
  normalizeFrequency,
  detectSuspiciousScheduleReduction,
  GoalPayloadGuardResult,
} from './goal-creation.util';

@Injectable()
export class GoalCreationNucleus implements Nucleus<
  ReplyAction | ContinueAction | CreateGoalAction | CancelAction
> {
  public static PROMPT = GOAL_PROMPT;
  private readonly logger = new Logger(GoalCreationNucleus.name);

  constructor(
    private readonly llm: ConversationAIService,
    private readonly comm: CommunicationService,
  ) {}

  private userTimezone(meta: Record<string, unknown>): string {
    for (const key of ['timezone', 'userTimezone'] as const) {
      const v = meta[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return 'America/Sao_Paulo';
  }

  private makeConfirmation(payload: ValidatedGoalPayload): string {
    const title = payload?.title ? `“${payload.title}”` : 'sua meta';
    const extra = payload?.conquestType ? ` (${payload.conquestType})` : '';
    return `Legal, ${title}${extra} registrada! Agora é só manter o foco 💪`;
  }

  async analyze(
    input: NucleusInput,
  ): Promise<
    FlowResult<ReplyAction | ContinueAction | CreateGoalAction | CancelAction>
  > {
    const text = (input.text || '').trim();
    // meta is allowed arbitrary JSON
    const meta: Record<string, unknown> =
      (input.meta as Record<string, unknown>) || {};

    try {
      this.logger.debug(
        `GoalCreation.analyze start: currentSession=${input.currentSession} text=${text} meta=${JSON.stringify(meta).slice(0, 2000)}`,
      );
      const now = new Date();
      const nowISO = now.toISOString();
      const tz = this.userTimezone(meta);
      const nowFormatted = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tz,
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
        this.logger.debug(
          `GoalCreation LLM raw: ${JSON.stringify(aiRes).slice(0, 2000)}`,
        );
      } catch (e) {
        this.logger.debug('GoalCreation: failed to stringify aiRes', e);
      }

      const { classification, finished, extracted, suggestedReply } = aiRes;

      // 🔴 REGRA DE RESPONSABILIDADE
      const allowed = [CLASSIFICATIONS.CONTINUE, CLASSIFICATIONS.CANCEL];

      // if the returned classification is not one of the ones we care about,
      // the nucleus typically declines responsibility. However, if the LLM
      // indicates the flow is finished and provides a complete payload, we
      // accept it as a finished creation (defensive fallback for noisy LLM).
      const hasPayload = Boolean(
        extracted &&
        extracted.payload &&
        Object.keys((extracted.payload as Record<string, unknown>) || {})
          .length > 0,
      );

      if (!(allowed as string[]).includes(classification)) {
        if (finished === true && hasPayload) {
          this.logger.warn(
            `GoalCreation: classification=${classification} but finished=true and payload present — accepting as finished (fallback)`,
          );
          // fall through to finished handling below
        } else {
          this.logger.debug(`GoalCreation: not my job (${classification})`);

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
        const actions: Array<
          ReplyAction | ContinueAction | CreateGoalAction | CancelAction
        > = [{ type: 'reply', text: suggestedReply } as ReplyAction];
        this.logger.debug(
          `GoalCreation returning UNCERTAIN actions=${JSON.stringify(actions).slice(0, 1000)} confidence=${aiRes.confidence}`,
        );
        return {
          actions,
          decision: DECISIONS.UNCERTAIN,
          confidence: aiRes.confidence,
        };
      }

      if (classification === CLASSIFICATIONS.CANCEL) {
        const actions: Array<
          ReplyAction | ContinueAction | CreateGoalAction | CancelAction
        > = [
          { type: 'cancel' } as CancelAction,
          {
            type: 'reply',
            text: suggestedReply ?? 'Criação de meta cancelada.',
          } as ReplyAction,
        ];
        this.logger.debug(
          `GoalCreation returning CANCEL actions=${JSON.stringify(actions).slice(0, 1000)} confidence=${aiRes.confidence}`,
        );
        return {
          actions,
          decision: DECISIONS.HANDLED,
          confidence: aiRes.confidence,
        };
      }

      const reallyFinished = finished === true;
      const payload: DraftGoalPayload =
        (extracted?.payload as DraftGoalPayload) || {};

      if (reallyFinished) {
        const finalPayload: DraftGoalPayload = { ...payload };

        const userId = String(input.userId || '');

        if (userId && (!finalPayload.title || !finalPayload.description)) {
          try {
            const md = await this.comm.generateProgressMetadata(userId, {
              goalTitle: String(finalPayload.title || text || ''),
            });

            if (!finalPayload.title) finalPayload.title = md.title;

            if (!finalPayload.description)
              finalPayload.description = md.description;
          } catch (e) {
            this.logger.warn('metadata generation failed', e);
          }
        }

        const guardedPayload = sanitizeGoalPayload(finalPayload, now, {
          ...meta,
          userTimezone: tz,
        });

        // 🔴 SPECIAL CASE: Detectado skip-today suspeito na turno anterior e usuário confirma agora
        // Se estava esperando confirmação para pausar e agora confirma → dismiss_goal_for_today
        if (
          meta?.suspiciousScheduleReductionDetected === true &&
          (text.toLowerCase().includes('sim') ||
            text.toLowerCase().includes('pode') ||
            text.toLowerCase().includes('pausar'))
        ) {
          const goalId = meta.goalId as string | undefined;
          if (goalId) {
            const eodDateTime = DateTime.now().setZone(tz).endOf('day');
            const silenceUntil = eodDateTime.toJSDate();

            const actions: Array<
              ReplyAction | ContinueAction | CreateGoalAction | CancelAction
            > = [
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

            this.logger.log(
              `GoalCreation: returning dismiss_goal_for_today for ${goalId} until ${silenceUntil}`,
            );
            return {
              actions,
              decision: DECISIONS.HANDLED,
              confidence: 0.95,
            };
          }
        }

        if (!guardedPayload.ok) {
          const actions: Array<
            ReplyAction | ContinueAction | CreateGoalAction | CancelAction
          > = [
            {
              type: 'continue',
              payload: {
                ...guardedPayload.continuePayload,
                // Marcar que detectamos redução suspeita para próxima turno poder executar dismiss
                ...(detectSuspiciousScheduleReduction(
                  meta,
                  guardedPayload.continuePayload.scheduleConfig,
                )
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

        let successReply =
          suggestedReply || this.makeConfirmation(guardedPayload.payload);
        if (guardedPayload.payload.scheduleConfig) {
          const scheduleBlock = formatScheduleForUser(
            guardedPayload.payload.scheduleConfig,
            guardedPayload.payload.title,
            tz,
          );
          if (scheduleBlock) {
            successReply = `${successReply}\n\n${scheduleBlock}`;
          }
        }
        const failureReply =
          'Não consegui salvar essa meta agora. Quer que eu tente de novo com você?';

        const actions: Array<
          ReplyAction | ContinueAction | CreateGoalAction | CancelAction
        > = [
          {
            type: 'create_goal',
            payload: guardedPayload.payload,
            successReply,
            failureReply,
          } as CreateGoalAction,
        ];

        try {
          this.logger.log(
            `GoalCreation: returning create_goal action, payload=${JSON.stringify(guardedPayload.payload).slice(0, 1000)}`,
          );
          this.logger.debug(
            `GoalCreation actions=${JSON.stringify(actions).slice(0, 1000)} confidence=${aiRes.confidence}`,
          );
        } catch (e) {
          this.logger.debug(
            'GoalCreation: failed to stringify create_goal actions for logging',
            e,
          );
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
            tz,
          );
          if (scheduleBlock) {
            replyText = `${replyText}\n\n${scheduleBlock}`;
          }
        }
        const actions: Array<
          ReplyAction | ContinueAction | CreateGoalAction | CancelAction
        > = [
          {
            type: 'continue',
            payload,
            to: FLOW_STATES.GOAL_CREATION,
          } as ContinueAction,
          { type: 'reply', text: replyText } as ReplyAction,
        ];
        try {
          this.logger.debug(
            `GoalCreation returning CONTINUE actions=${JSON.stringify(actions).slice(0, 1000)} confidence=${aiRes.confidence}`,
          );
        } catch (e) {
          this.logger.debug(
            'GoalCreation: failed to stringify default actions for logging',
            e,
          );
        }
        for (const a of actions) {
          if ((a as any).type === 'continue' && !(a as any).to) {
            this.logger.warn(
              'GoalCreation: default continuation has no `to` — follow-ups may be routed away',
            );
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
            text: 'Tive dificuldade para interpretar sua meta. Pode reformular em uma frase simples?',
          },
        ],
        decision: DECISIONS.HANDLED,
        confidence: 0,
      };
    }
  }
}

export default GoalCreationNucleus;
