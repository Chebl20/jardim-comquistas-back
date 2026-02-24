import { Module } from '@nestjs/common';
import { ConversationOrchestratorService } from './conversation/conversation-orchestrator.service';
import { GoalCreationNucleus } from './nuclei/goal-creation';
import { ClarificationNucleus } from './nuclei/clarification';
import { IntentRouter } from './intent-router.service';
import { RulesService } from './rules.service';
import { ConversationAIService } from './conversation-ai.service';
import { UserGoalModule } from '../goals/user-goal.module';
import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [UserGoalModule, SharedModule, WorldsModule],
  providers: [
    ConversationOrchestratorService,
    GoalCreationNucleus,
    ClarificationNucleus,
    IntentRouter,
    RulesService,
    ConversationAIService,
  ],
  exports: [ConversationOrchestratorService, IntentRouter],
})
export class AiModule {}
