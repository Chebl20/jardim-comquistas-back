import { Injectable, Logger } from '@nestjs/common';
import { UserGoalService } from '../../../goals/user-goal.service';
import { FLOW_STATES } from '../flow.types';
import { NucleusMetaBuilder, NucleusMetaBuildContext } from './nucleus-meta.builder';

@Injectable()
export class GoalProgressMetaBuilder implements NucleusMetaBuilder {
  private readonly logger = new Logger(GoalProgressMetaBuilder.name);
  private readonly recentMessagesContext = 5;

  constructor(private readonly userGoalService: UserGoalService) {}

  supports(state: string): boolean {
    return state === FLOW_STATES.GOAL_PROGRESS;
  }

  async build(context: NucleusMetaBuildContext): Promise<Record<string, any>> {
    const { sessionPayload, worldId, userId } = context;
    const recent = Array.isArray(sessionPayload.recentMessages) ? sessionPayload.recentMessages : [];
    const meta: Record<string, any> = {
      ...sessionPayload,
      worldId,
      recentMessages: recent.slice(-Math.max(3, this.recentMessagesContext)),
    };

    if (Array.isArray(sessionPayload.candidates) && sessionPayload.candidates.length > 0) {
      meta.candidates = sessionPayload.candidates;
    }
    if (sessionPayload.pendingGoalId) {
      meta.pendingGoalId = sessionPayload.pendingGoalId;
      meta.pendingGoalTitle = sessionPayload.pendingGoalTitle;
      meta.pendingGoalType = sessionPayload.pendingGoalType;
      meta.pendingUserMessage = sessionPayload.pendingUserMessage;
    }
    if (sessionPayload.pendingUserMessage && !meta.pendingUserMessage) {
      meta.pendingUserMessage = sessionPayload.pendingUserMessage;
    }

    try {
      const goals = await this.userGoalService.getGoalsForUser(userId);
      meta.userGoalsSummary = (goals || []).map((g: any) => ({
        id: g.id,
        title: g.title,
        type: g.goalType,
        goalType: g.goalType,
      }));
      meta.totalGoals = meta.userGoalsSummary.length;
    } catch (e) {
      this.logger.warn('Failed to fetch userGoals for GoalProgress nucleus', e);
      meta.userGoalsSummary = [];
      meta.totalGoals = 0;
    }

    return meta;
  }
}
