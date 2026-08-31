import { Injectable, Logger } from '@nestjs/common';
import { UserGoalService } from '../../goals/user-goal.service';
import { WorldsEventsService } from '../../worlds/worlds.events.service';
import { normalizeConquestType } from '../conquest-type.enum';
import { normalizeGoalType } from '../goal-type.util';
import { Action, CreateGoalAction, FlowState, ValidatedGoalPayload } from './flow.types';
import { ConversationStateService } from './conversation-state.service';

export interface ActionExecutionResult {
  reply: string;
  redirectedTo?: FlowState;
}

function isValidatedGoalPayload(payload: ValidatedGoalPayload | null | undefined): payload is ValidatedGoalPayload {
  if (!payload) return false;
  if (typeof payload.title !== 'string' || !payload.title.trim()) return false;
  if (normalizeGoalType(payload.goalType) !== payload.goalType) return false;
  if (normalizeConquestType(payload.conquestType) !== payload.conquestType) return false;
  if (payload.frequency !== undefined && (!Number.isInteger(payload.frequency) || payload.frequency <= 0)) return false;
  if (payload.reminderTime !== undefined && typeof payload.reminderTime !== 'string') return false;
  if (payload.scheduleConfig !== undefined && payload.scheduleConfig !== null) {
    const sc = payload.scheduleConfig as {
      type?: string;
      at?: string;
      times?: unknown[];
      daysOfWeek?: unknown[];
      dayOfMonth?: unknown;
      durationDays?: unknown;
    };
    if (!sc.type || !['once', 'daily', 'weekly', 'monthly'].includes(sc.type)) return false;
    if (sc.type === 'once' && (typeof sc.at !== 'string' || !sc.at.trim())) return false;
    if (sc.type === 'daily') {
      if (!Array.isArray(sc.times) || sc.times.length === 0 || !sc.times.every((t) => typeof t === 'string'))
        return false;
      if (
        sc.durationDays !== undefined &&
        (typeof sc.durationDays !== 'number' || !Number.isInteger(sc.durationDays) || sc.durationDays < 1)
      )
        return false;
    }
    if (sc.type === 'weekly') {
      if (
        !Array.isArray(sc.daysOfWeek) ||
        sc.daysOfWeek.length === 0 ||
        !sc.daysOfWeek.every((d) => typeof d === 'number' && Number.isInteger(d))
      )
        return false;
      if (!Array.isArray(sc.times) || sc.times.length === 0 || !sc.times.every((t) => typeof t === 'string'))
        return false;
    }
    if (sc.type === 'monthly') {
      const dom =
        typeof sc.dayOfMonth === 'number' ? sc.dayOfMonth : parseInt(String(sc.dayOfMonth), 10);
      if (!Number.isInteger(dom) || dom < 1 || dom > 31) return false;
      if (!Array.isArray(sc.times) || sc.times.length === 0 || !sc.times.every((t) => typeof t === 'string'))
        return false;
    }
  }
  const hasSchedule =
    payload.scheduleConfig != null &&
    typeof payload.scheduleConfig === 'object' &&
    typeof (payload.scheduleConfig as { type?: string }).type === 'string';
  const hasReminderTime =
    typeof payload.reminderTime === 'string' && payload.reminderTime.trim().length > 0;
  if (!hasSchedule && !hasReminderTime) return false;
  return true;
}

@Injectable()
export class ConversationActionExecutorService {
  private readonly logger = new Logger(ConversationActionExecutorService.name);

  constructor(
    private readonly stateService: ConversationStateService,
    private readonly userGoalService: UserGoalService,
    private readonly worldsEventsService: WorldsEventsService,
  ) {}

  async execute(
    userId: string,
    actions: Action[],
    worldId: string,
  ): Promise<ActionExecutionResult> {
    let reply = '';
    let redirectedTo: FlowState | undefined;

    try {
      const brief = actions.map(a => ({ type: a.type, text: (a as { text?: string }).text ?? null }));
      this.logger.log(`execute: user=${userId} actions=${JSON.stringify(brief)}`);
    } catch (_) {}

    for (const action of actions) {
      const t0 = Date.now();
      if (action.type === 'reply') {
        reply = action.text ?? reply;
        await this.stateService.appendAssistantMessage(userId, action.text ?? '');
      } else {
        const res = await this.applyAction(userId, action, worldId);
        if (res?.redirectedTo) redirectedTo = res.redirectedTo;
        if (res?.reply) reply = res.reply;
      }
      this.logger.debug(`processed action ${action.type} in ${Date.now() - t0}ms`);
    }

    return { reply, redirectedTo };
  }

  private async applyAction(
    userId: string,
    action: Action,
    worldId: string,
  ): Promise<{ redirectedTo?: FlowState; reply?: string }> {
    switch (action.type) {
      case 'continue': {
        const extra: Record<string, unknown> =
          action.payload && typeof action.payload === 'object' ? (action.payload as Record<string, unknown>) : {};
        await this.stateService.continueFlow(userId, extra, action.to);
        return {};
      }

      case 'redirect': {
        const extra: Record<string, unknown> =
          action.payload && typeof action.payload === 'object' ? (action.payload as Record<string, unknown>) : {};
        await this.stateService.redirectFlow(userId, action.to, extra);
        return { redirectedTo: action.to };
      }

      case 'create_goal': {
        const createAction = action as CreateGoalAction;
        const goalData = createAction.payload;
        this.logger.debug(`create_goal action received; payload=${JSON.stringify(goalData)}`);

        if (!isValidatedGoalPayload(goalData)) {
          this.logger.error(
            `create_goal blocked at executor due to invalid payload=${JSON.stringify(goalData)}`,
          );
          await this.stateService.appendAssistantMessage(userId, createAction.failureReply);
          await this.stateService.resetFlow(userId);
          return { reply: createAction.failureReply };
        }

        try {
          const createData = {
            ...goalData,
            userId,
            worldId,
            scheduleConfig: goalData.scheduleConfig ?? undefined,
          };
          const created = await this.userGoalService.createUserGoalWithTree(createData);
          this.logger.log(
            `create_goal: created id=${(created as { id?: string; plantedTreeId?: string })?.id} plantedTreeId=${(created as { plantedTreeId?: string })?.plantedTreeId || 'n/a'}`,
          );

          await this.stateService.appendAssistantMessage(userId, createAction.successReply);
          await this.stateService.resetFlow(userId);
          return { reply: createAction.successReply };
        } catch (error) {
          this.logger.error('create_goal action failed', error);
          await this.stateService.appendAssistantMessage(userId, createAction.failureReply);
          await this.stateService.resetFlow(userId);
          return { reply: createAction.failureReply };
        }
      }

      case 'cancel': {
        await this.stateService.resetFlow(userId);
        return {};
      }

      case 'mark_done': {
        try {
          const { goalId, goalTitle, goalType, userMessage } = action.payload;
          if (goalId) {
            await this.userGoalService.markGoalDoneFromReminder(goalId, goalType);
            this.logger.log(`Goal ${goalId} marked done via reminder`);
          }
          try {
            await this.worldsEventsService.progressPlantedTree(worldId, {
              goalId,
              userId,
              userMessage,
            });
          } catch (inner) {
            this.logger.warn('failed to record growth event after reminder', inner);
          }
        } catch (e) {
          this.logger.error('mark_done action failed', e);
        }
        return {};
      }

      case 'update_reminder': {
        const { goalId, dailyStatus, silenceUntil, clearSession } = action.payload;
        try {
          if (goalId) {
            await this.userGoalService.updateReminderState(goalId, {
              dailyStatus,
              silenceUntil:
                typeof silenceUntil === 'string'
                  ? new Date(silenceUntil)
                  : silenceUntil,
            });
          }
          if (clearSession) {
            await this.stateService.resetFlow(userId);
          }
        } catch (e) {
          this.logger.error('update_reminder action failed', e);
        }
        return {};
      }

      case 'mark_multiple_done': {
        const { goals, userMessage } = action.payload;
        try {
          if (Array.isArray(goals) && goals.length > 0) {
            for (const g of goals) {
              if (g?.id) {
                await this.userGoalService.markGoalDoneFromReminder(g.id);
                this.logger.log(`Goal ${g.id} marked done via mark_multiple_done`);
                try {
                  await this.worldsEventsService.progressPlantedTree(worldId, {
                    goalId: g.id,
                    userId,
                    userMessage,
                  });
                } catch (inner) {
                  this.logger.warn('failed to record growth event after mark_multiple_done', inner);
                }
              }
            }
          }
        } catch (e) {
          this.logger.error('mark_multiple_done action failed', e);
        }
        return {};
      }

      case 'dismiss_goal_for_today': {
        const { goalId, silenceUntil } = (action.payload as { goalId: string; silenceUntil?: string | Date });
        try {
          if (goalId) {
            // 🔴 Validar se goal existe antes de atualizar reminder
            const goal = await this.userGoalService.getGoalsByIds([goalId]);
            if (!goal || goal.length === 0) {
              this.logger.warn(
                `dismiss_goal_for_today: goal ${goalId} not found or already deleted — skipping reminder update`,
              );
              return {};
            }

            const until = typeof silenceUntil === 'string' ? new Date(silenceUntil) : silenceUntil;
            await this.userGoalService.updateReminderState(goalId, {
              silenceUntil: until ?? undefined,
            });
            this.logger.log(`Goal ${goalId} dismissed for today until ${until}`);
          }
        } catch (e) {
          this.logger.error('dismiss_goal_for_today action failed', e);
        }
        return {};
      }

      case 'reply':
        return {};
    }
  }
}
