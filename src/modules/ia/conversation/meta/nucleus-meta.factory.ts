import { Injectable } from '@nestjs/common';
import { NucleusMetaBuildContext, NucleusMetaBuilder } from './nucleus-meta.builder';
import { GoalStatusMetaBuilder } from './goal-status-meta.builder';
import { GoalProgressMetaBuilder } from './goal-progress-meta.builder';

@Injectable()
export class NucleusMetaFactory {
  constructor(
    private readonly goalStatusMetaBuilder: GoalStatusMetaBuilder,
    private readonly goalProgressMetaBuilder: GoalProgressMetaBuilder,
  ) {}

  async build(context: NucleusMetaBuildContext): Promise<Record<string, any>> {
    const builder = this.resolveBuilder(context.state);
    return builder.build(context);
  }

  private resolveBuilder(state: string): NucleusMetaBuilder {
    if (this.goalStatusMetaBuilder.supports(state as never)) {
      return this.goalStatusMetaBuilder;
    }
    if (this.goalProgressMetaBuilder.supports(state as never)) {
      return this.goalProgressMetaBuilder;
    }

    return {
      supports: () => true,
      build: async ({ sessionPayload, worldId }) => {
        const recent = Array.isArray(sessionPayload.recentMessages) ? sessionPayload.recentMessages : [];
        return {
          ...sessionPayload,
          worldId,
          recentMessages: recent.slice(-3),
        };
      },
    };
  }
}
