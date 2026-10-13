import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  NucleusMetaBuildContext,
  NucleusMetaBuilder,
} from './nucleus-meta.builder';
import { GoalStatusMetaBuilder } from './goal-status-meta.builder';
import { GoalProgressMetaBuilder } from './goal-progress-meta.builder';
import { WorldsService } from '../../../worlds/worlds.service';

@Injectable()
export class NucleusMetaFactory {
  constructor(
    private readonly goalStatusMetaBuilder: GoalStatusMetaBuilder,
    private readonly goalProgressMetaBuilder: GoalProgressMetaBuilder,
    @Inject(forwardRef(() => WorldsService))
    private readonly worldsService: WorldsService,
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
        const recent = Array.isArray(sessionPayload.recentMessages)
          ? sessionPayload.recentMessages
          : [];
        let worldName: string | undefined;
        try {
          const world = await this.worldsService.getWorldById(worldId);
          worldName = world?.name;
        } catch {
          // fallback: derive from worldId (ex: mundo2 → Mundo2)
          worldName = worldId
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase());
        }
        return {
          ...sessionPayload,
          worldId,
          worldName: worldName || worldId,
          recentMessages: recent.slice(-3),
        };
      },
    };
  }
}
