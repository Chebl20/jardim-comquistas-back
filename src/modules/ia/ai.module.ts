import { Module } from '@nestjs/common';
import { IntentRouter } from './intent-router.service';
import { RulesService } from './rules.service';
import { ConversationAIService } from './conversation-ai.service';
import { ConversationOrchestratorService } from './conversation/conversation-orchestrator.service';
import { GoalCreationNucleus } from './nuclei/goal-creation';
import { ClarificationNucleus } from './nuclei/clarification';
import { DateExtractionNucleus } from './nuclei/date-extraction';
import { SmallTalkNucleus } from './nuclei/smalltalk';
import { IntentNucleus } from './conversation/intent-nucleus.service';
import { RecoveryNucleus } from './conversation/recovery-nucleus.service';
import { ProcessingNucleus } from './conversation/processing-nucleus.service';

import { UserGoalModule } from '../goals/user-goal.module';

import { WorldsModule } from '../worlds/worlds.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [UserGoalModule, SharedModule, WorldsModule],
  providers: [
    ConversationAIService,
    ConversationOrchestratorService,
    GoalCreationNucleus,
    ClarificationNucleus,
    DateExtractionNucleus,
    SmallTalkNucleus,
    IntentNucleus,
    RecoveryNucleus,
    ProcessingNucleus,
    IntentRouter,
    RulesService,
  ],
  exports: [IntentRouter, ConversationAIService, ConversationOrchestratorService],
})
export class AiModule {}
