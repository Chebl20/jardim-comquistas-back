import { ConversationOrchestratorService } from '../src/modules/ia/conversation/conversation-orchestrator.service';
import { ConversationActionExecutorService } from '../src/modules/ia/conversation/conversation-action-executor.service';
import { ConversationStateService } from '../src/modules/ia/conversation/conversation-state.service';
import { FlowRoutingPolicyService } from '../src/modules/ia/conversation/flow-routing-policy.service';
import { NucleusMetaFactory } from '../src/modules/ia/conversation/meta/nucleus-meta.factory';
import { GoalStatusMetaBuilder } from '../src/modules/ia/conversation/meta/goal-status-meta.builder';
import { GoalProgressMetaBuilder } from '../src/modules/ia/conversation/meta/goal-progress-meta.builder';
import {
  FlowResult,
  FlowState,
  FLOW_STATES,
} from '../src/modules/ia/conversation/flow.types';
import {
  NucleusInput,
  Nucleus,
} from '../src/modules/ia/nuclei/nucleus.interface';
import { RouterResult } from '../src/modules/ia/nuclei/router/index';

// simple in-memory session service fulfilling needed interface
class InMemorySessionService {
  private store = new Map<string, any>();

  async createSession(
    userId: string,
    state: string,
    payload: any = {},
    ttlMin?: number,
  ) {
    this.store.set(userId, { userId, state, payload, version: 0 });
    return this.store.get(userId);
  }
  async getSession(userId: string) {
    return this.store.get(userId) || null;
  }
  async updateSession(
    userId: string,
    data: { state?: string; payload?: any; expiresAt?: Date },
  ) {
    const s = this.store.get(userId);
    if (!s) throw new Error('session not found');
    Object.assign(s, data);
    return s;
  }
  async updateSessionVersioned(
    userId: string,
    data: { state?: string; payload?: any; expiresAt?: Date },
    expectedVersion: number,
  ) {
    const s = this.store.get(userId);
    if (!s) throw new Error('session not found');
    if (s.version !== expectedVersion) throw new Error('version conflict');
    Object.assign(s, data);
    s.version += 1;
    return s;
  }
  async touchSession(userId: string, extraMin?: number) {
    return null;
  }
  async deleteSession(userId: string) {
    this.store.delete(userId);
  }
  async cleanupExpired() {
    return null;
  }
}

// stubs for other services
const mockUserGoalService: any = {
  getGoalsForUser: async () => [
    {
      id: 'g1',
      title: 'Beber água',
      description: 'Beber 2L por dia',
      goalType: 'Continua',
      conquestType: 'Saúde',
      completed: false,
      createdAt: new Date().toISOString(),
      plantedTree: {
        id: 't1',
        anchorId: 'a1',
        actualStage: 1,
        createdAt: new Date().toISOString(),
        treeCatalog: { family: 'a', type: 'continua' },
        growthEvents: [
          {
            id: 'e1',
            stage: 1,
            createdAt: new Date().toISOString(),
            title: 'Planted',
            description: '',
            progressIndex: 1,
          },
        ],
      },
    },
  ],
};
const mockWorldsEvents: any = { progressPlantedTree: async () => {} };

// patch prisma.user.findUnique
jest.mock('../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }) => ({
        id: where.id,
        currentWorldId: 'mundo1',
      })),
    },
  },
}));

// helper to build orchestrator with custom nuclei/router
function makeOrchestrator(
  nuclei: Partial<Record<FlowState, Nucleus>>,
  router: { analyze(input: NucleusInput): Promise<RouterResult> },
) {
  const clar =
    nuclei[FLOW_STATES.CLARIFICATION] ||
    ({
      analyze: async () => ({
        actions: [],
        decision: 'handled',
        confidence: 1,
      }),
    } as Nucleus);
  const goalCreation = nuclei[FLOW_STATES.GOAL_CREATION] || clar;
  const reminder = nuclei[FLOW_STATES.REMINDER] || clar;
  const goalStatus = nuclei[FLOW_STATES.GOAL_STATUS] || clar;
  const goalProgress = nuclei[FLOW_STATES.GOAL_PROGRESS] || clar;
  const routerN = router as any;
  const sess = new InMemorySessionService();
  const stateService = new ConversationStateService(sess as any);
  const actionExecutor = new ConversationActionExecutorService(
    stateService as any,
    mockUserGoalService,
    mockWorldsEvents,
  );
  const goalStatusMetaBuilder = new GoalStatusMetaBuilder(mockUserGoalService);
  const goalProgressMetaBuilder = new GoalProgressMetaBuilder(
    mockUserGoalService,
  );
  const nucleusMetaFactory = new NucleusMetaFactory(
    goalStatusMetaBuilder,
    goalProgressMetaBuilder,
    {} as any,
  );
  const routingPolicy = new FlowRoutingPolicyService();
  const orchestrator = new ConversationOrchestratorService(
    clar as any,
    goalCreation as any,
    goalStatus as any,
    reminder as any,
    goalProgress as any,
    routerN,
    actionExecutor as any,
    stateService as any,
    routingPolicy as any,
    nucleusMetaFactory as any,
  );
  (orchestrator as any).sessionService = sess;
  return orchestrator;
}

describe('ConversationOrchestrator contract tests', () => {
  it('throws when nucleus returns invalid decision', async () => {
    const badNuc: Nucleus = {
      analyze: async () => ({
        actions: [],
        decision: 'foo' as any,
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      { [FLOW_STATES.CLARIFICATION]: badNuc },
      { analyze: async () => ({ target: null, confidence: 1 }) },
    );
    await expect(
      orch.handle({ userId: 'u1', userMessage: 'x' }),
    ).resolves.toMatchObject({
      reply: 'Algo deu errado. Pode repetir?',
      origin: 'orchestrator',
    });
  });

  it('router invalid confidence degrades gracefully to clarification', async () => {
    // Núcleo que recusa (usado no estado GOAL_CREATION para simular NOT_MY_JOB inicial)
    const nuc: Nucleus = {
      analyze: async () => ({
        actions: [],
        decision: 'not_my_job',
        confidence: 0.5,
      }),
    };
    const badRouter = {
      analyze: async () => ({
        target: FLOW_STATES.GOAL_STATUS as any,
        confidence: 2,
      }),
    };
    const clar: Nucleus = {
      analyze: async () => ({
        actions: [{ type: 'reply', text: 'clar' }],
        decision: 'handled',
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      { [FLOW_STATES.GOAL_CREATION]: nuc, [FLOW_STATES.CLARIFICATION]: clar },
      badRouter,
    );
    // sessão começa em GOAL_CREATION para o nucleus `nuc` ser chamado primeiro
    const sessService = (orch as any).sessionService as InMemorySessionService;
    await sessService.createSession('u1', FLOW_STATES.GOAL_CREATION, {});
    const res = await orch.handle({ userId: 'u1', userMessage: 'x' });
    expect(res.reply).toBe('clar');
  });

  it('not_my_job with actions throws', async () => {
    const nuc: Nucleus = {
      analyze: async () => ({
        actions: [{ type: 'reply', text: '' }],
        decision: 'not_my_job',
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      { [FLOW_STATES.CLARIFICATION]: nuc },
      { analyze: async () => ({ target: null, confidence: 1 }) },
    );
    await expect(
      orch.handle({ userId: 'u1', userMessage: 'x' }),
    ).resolves.toMatchObject({
      reply: 'Algo deu errado. Pode repetir?',
      origin: 'orchestrator',
    });
  });

  it('max one routing and second not_my_job forces clarification', async () => {
    const a: Nucleus = {
      analyze: async () => ({
        actions: [],
        decision: 'not_my_job',
        confidence: 1,
      }),
    };
    const b: Nucleus = {
      analyze: async () => ({
        actions: [],
        decision: 'not_my_job',
        confidence: 1,
      }),
    };
    const clar: Nucleus = {
      analyze: async () => ({
        actions: [{ type: 'reply', text: 'clar' }],
        decision: 'handled',
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      {
        [FLOW_STATES.GOAL_CREATION]: a,
        [FLOW_STATES.GOAL_STATUS]: b,
        [FLOW_STATES.CLARIFICATION]: clar,
      },
      {
        analyze: async () => ({
          target: FLOW_STATES.GOAL_STATUS,
          confidence: 1,
        }),
      },
    );
    // sessão começa em GOAL_CREATION → recusa → router aponta GOAL_STATUS → recusa → cai em CLARIFICATION
    const sessService = (orch as any).sessionService as InMemorySessionService;
    await sessService.createSession('u1', FLOW_STATES.GOAL_CREATION, {});
    const res = await orch.handle({ userId: 'u1', userMessage: 'x' });
    expect(res.reply).toEqual('clar');
  });

  it('history always present and state changes only via orchestrator', async () => {
    const nuc: Nucleus = {
      analyze: async () => ({
        actions: [{ type: 'reply', text: 'ok' }],
        decision: 'handled',
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      { [FLOW_STATES.CLARIFICATION]: nuc },
      { analyze: async () => ({ target: null, confidence: 1 }) },
    );
    const res = await orch.handle({ userId: 'u1', userMessage: 'hello' });
    expect(res.reply).toBe('ok');
    const sess = (orch as any).sessionService as InMemorySessionService;
    const sessData = await sess.getSession('u1');
    expect(Array.isArray(sessData.payload.recentMessages)).toBe(true);
    expect(sessData.state).toBe(FLOW_STATES.CLARIFICATION);
  });

  it('concurrency control rejects version conflict', async () => {
    const nuc: Nucleus = {
      analyze: async () => ({
        actions: [],
        decision: 'handled',
        confidence: 1,
      }),
    };
    const orch = makeOrchestrator(
      { [FLOW_STATES.CLARIFICATION]: nuc },
      { analyze: async () => ({ target: null, confidence: 1 }) },
    );
    // prime session
    const sessService = (orch as any).sessionService as InMemorySessionService;
    await sessService.createSession('u2', FLOW_STATES.CLARIFICATION, {});
    // manually bump version to simulate concurrent write
    const s0 = await sessService.getSession('u2');
    await sessService.updateSessionVersioned(
      'u2',
      { state: FLOW_STATES.CLARIFICATION },
      s0.version,
    );
    // sem ação que escreva sessão, a conversa segue segura e sem crash.
    await expect(
      orch.handle({ userId: 'u2', userMessage: 'hi' }),
    ).resolves.toMatchObject({
      reply: '',
      origin: FLOW_STATES.CLARIFICATION,
    });
  });
});
