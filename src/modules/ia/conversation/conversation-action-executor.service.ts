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
          const created = await this.userGoalService.createUserGoalWithTree({
            ...goalData,
            userId,
            worldId,
          });
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
          const { goalId, goalTitle, goalDescription, goalType } = action.payload;
          if (goalId) {
            await this.userGoalService.markGoalDoneFromReminder(goalId, goalType);
            this.logger.log(`Goal ${goalId} marked done via reminder`);
          }
          try {
            await this.worldsEventsService.progressPlantedTree(worldId, {
              goalId,
              userId,
              title: goalTitle,
              description: goalDescription,
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

      case 'reply':
        return {};
    }
  }
}
