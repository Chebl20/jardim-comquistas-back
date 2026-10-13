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
import { GardenGuideController } from './garden-guide.controller';
import { UserGoalModule } from '../goals/user-goal.module';
import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';
import { ReminderPolicyModule } from '../reminder/reminder-policy.module';

@Module({
  imports: [
    forwardRef(() => UserGoalModule),
    forwardRef(() => SharedModule),
    forwardRef(() => WorldsModule),
    ReminderPolicyModule,
  ],
  controllers: [GardenGuideController],
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
  ],
  exports: [
    ConversationOrchestratorService,
    ReminderNucleus,
    ConversationAIService,
  ],
})
export class AiModule {}
