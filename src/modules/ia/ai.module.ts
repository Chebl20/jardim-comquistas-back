import { Module, forwardRef } from '@nestjs/common';
import { ConversationOrchestratorService } from './conversation/conversation-orchestrator.service';
import { ConversationActionExecutorService } from './conversation/conversation-action-executor.service';
import { ConversationStateService } from './conversation/conversation-state.service';
import { NucleusMetaFactory } from './conversation/meta/nucleus-meta.factory';
import { GoalStatusMetaBuilder } from './conversation/meta/goal-status-meta.builder';
import { GoalProgressMetaBuilder } from './conversation/meta/goal-progress-meta.builder';
import { FlowRoutingPolicyService } from './conversation/flow-routing-policy.service';
import { GoalCreationNucleus } from './nuclei/goal-creation';
import { GoalStatusNucleus } from './nuclei/goal-status';
import { RouterNucleus } from './nuclei/router';
import { ClarificationNucleus } from './nuclei/clarification';
import { ConversationAIService } from './conversation-ai.service';
import { ReminderNucleus } from './nuclei/reminder';
import { GoalProgressNucleus } from './nuclei/goal-progress';
import { ReminderPolicyEngine } from '../reminder/policy/reminder-policy.engine';
import { ReminderObservabilityService } from '../reminder/observability/reminder-observability.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [UserGoalModule, forwardRef(() => SharedModule), WorldsModule],
providers: [
  ConversationOrchestratorService,
  ConversationActionExecutorService,
  ConversationStateService,
  NucleusMetaFactory,
  GoalStatusMetaBuilder,
  GoalProgressMetaBuilder,
  FlowRoutingPolicyService,
  GoalCreationNucleus,
  GoalStatusNucleus,
  ClarificationNucleus,
  ReminderNucleus,
  GoalProgressNucleus,
  RouterNucleus,
  ConversationAIService,
  ReminderPolicyEngine,
  ReminderObservabilityService,
],
exports: [ConversationOrchestratorService, ReminderNucleus, ConversationAIService],
})
export class AiModule {}
