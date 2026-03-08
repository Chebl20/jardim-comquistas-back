import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, Nucleus } from '../nuclei/nucleus.interface';
import { ClarificationNucleus } from '../nuclei/clarification';
import { GoalCreationNucleus } from '../nuclei/goal-creation';
import { GoalStatusNucleus } from '../nuclei/goal-status';
import { ReminderNucleus } from '../nuclei/reminder';
import { GoalProgressNucleus } from '../nuclei/goal-progress';
import { RouterNucleus } from '../nuclei/router';
import { ConversationActionExecutorService } from './conversation-action-executor.service';
import { ConversationStateService } from './conversation-state.service';
import { FlowRoutingPolicyService } from './flow-routing-policy.service';
import { NucleusMetaFactory } from './meta/nucleus-meta.factory';
import { prisma } from '../../../prisma/client';
import { FlowResult, FlowState, DECISIONS, FLOW_STATES } from './flow.types';

const DEFAULT_WORLD_ID = 'mundo1';

export interface OrchestratorInput {
  userId: string | number;
  userMessage?: string;
  text?: string;
  onAck?: (message: string) => Promise<void>;
}

export interface OrchestratorOutput {
  kind: string;
  reply: string;
  origin: string | FlowState;
}

@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);
  private readonly flows: Record<FlowState, Nucleus>;

  constructor(
    private readonly clarification: ClarificationNucleus,
    private readonly goalCreation: GoalCreationNucleus,
    private readonly goalStatus: GoalStatusNucleus,
    private readonly reminderNucleus: ReminderNucleus,
    private readonly goalProgressNucleus: GoalProgressNucleus,
    private readonly router: RouterNucleus,
    private readonly actionExecutor: ConversationActionExecutorService,
    private readonly stateService: ConversationStateService,
    private readonly routingPolicy: FlowRoutingPolicyService,
    private readonly nucleusMetaFactory: NucleusMetaFactory,
  ) {
    this.flows = {
      CLARIFICATION: this.clarification,
      GOAL_CREATION: this.goalCreation,
      REMINDER: this.reminderNucleus,
      GOAL_STATUS: this.goalStatus,
      GOAL_PROGRESS: this.goalProgressNucleus,
    };

    // sanity check: garante que o registry e os flows locais concordam
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { nucleusRegistry } = require('./nucleus-registry');
    for (const key of Object.keys(nucleusRegistry) as FlowState[]) {
      if (!this.flows[key]) {
        this.logger.warn(`Registry contains state ${key} which is not wired in orchestrator`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private async resolveUserContext(userId: string): Promise<{ worldId: string; timezone: string }> {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      return {
        worldId: user?.currentWorldId || DEFAULT_WORLD_ID,
        timezone: user?.timezone || 'America/Sao_Paulo',
      };
    } catch {
      return { worldId: DEFAULT_WORLD_ID, timezone: 'America/Sao_Paulo' };
    }
  }

  private validateFlowResult(result: FlowResult) {
    if (![DECISIONS.HANDLED, DECISIONS.NOT_MY_JOB, DECISIONS.UNCERTAIN].includes(result.decision)) {
      throw new Error(`Invalid decision: "${result.decision}"`);
    }
    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
      throw new Error(`Invalid confidence: ${result.confidence}`);
    }
    if (result.decision === DECISIONS.NOT_MY_JOB && result.actions && result.actions.length > 0) {
      throw new Error('not_my_job result must not include actions');
    }
  }

  // ---------------------------------------------------------------------------
  // Ponto de entrada principal
  // ---------------------------------------------------------------------------

  async handle(opts: OrchestratorInput): Promise<OrchestratorOutput> {
    try {
      const userId = String(opts.userId || '');
      const incomingText = String(opts.userMessage || opts.text || '');

      // 1. Carregar sessão uma única vez — authority para estado e payload
      const loaded = await this.stateService.load(userId);
      const session = loaded.session;
      const sessionPayload: Record<string, any> = loaded.payload;

      // 2. Registrar mensagem do usuário no histórico recente
      if (incomingText.trim().length > 0) {
        const updatedPayload = await this.stateService.appendUserMessage(userId, incomingText, session);
        if (updatedPayload) {
          sessionPayload.recentMessages = updatedPayload.recentMessages;
        }
      }

      // 3. Determinar estado inicial (sessão persistida tem prioridade)
      const rawState = (session?.state ?? FLOW_STATES.CLARIFICATION) as FlowState;
      let currentState: FlowState = this.flows[rawState] ? rawState : FLOW_STATES.CLARIFICATION;
      if (!this.flows[rawState]) {
        this.logger.debug(`Session state ${rawState} not wired; falling back to CLARIFICATION`);
      }

      // 4. Resolver worldId e timezone do usuário (única query ao DB para ambos)
      const { worldId, timezone } = await this.resolveUserContext(userId);

      // Helper: executa o núcleo do estado dado, buscando sessão atualizada
      const runNucleus = async (state: FlowState): Promise<FlowResult> => {
        const fresh = await this.stateService.load(userId);
        const payload: Record<string, any> = fresh.payload;
        const meta = await this.nucleusMetaFactory.build({
          state,
          sessionPayload: payload,
          worldId,
          userId,
          timezone,
        });
        const input: NucleusInput = { userId, currentSession: state, text: incomingText, meta };
        const nucleus = this.flows[state] ?? this.clarification;
        const result = await nucleus.analyze(input);
        this.validateFlowResult(result);
        this.logger.log(
          `Orchestrator: nucleus=${state} decision=${result.decision} actions=[${result.actions.map(a => a.type).join(',')}]`,
        );
        return result;
      };

      // 5. Chamada primária ao núcleo
      const firstResult = await runNucleus(currentState);

      if (firstResult.decision !== DECISIONS.NOT_MY_JOB) {
        const exec = await this.actionExecutor.execute(userId, firstResult.actions, worldId);
        return { kind: 'direct', reply: exec.reply || '', origin: currentState };
      }

      // 6. NOT_MY_JOB → consultar router (rejectedBy: núcleo que recusou — Router não deve retorná-lo)
      const previousState = currentState;
      const routerInput: NucleusInput = {
        userId,
        currentSession: currentState,
        text: incomingText,
        meta: {
          ...sessionPayload,
          worldId,
          ...(firstResult.extracted?.payload || {}),
          rejectedBy: previousState,
        },
      };
      const routerRes = await this.router.analyze(routerInput);
      this.logger.debug(`Router: target=${String(routerRes.target)} confidence=${routerRes.confidence}`);

      const routingDecision = this.routingPolicy.resolve({
        currentState,
        routerTarget: routerRes.target,
        routerConfidence: routerRes.confidence,
        availableFlows: this.flows,
      });
      currentState = routingDecision.nextState;

      if (currentState === previousState) {
        await this.stateService.appendAssistantMessage(userId, 'Não consegui entender. Pode reformular?');
        return { kind: 'direct', reply: 'Não consegui entender. Pode reformular?', origin: FLOW_STATES.CLARIFICATION };
      }

      if (currentState !== previousState) {
        const redirectedPayload =
          previousState === FLOW_STATES.REMINDER && currentState !== FLOW_STATES.REMINDER
            ? {
                ...sessionPayload,
                reminderContext: undefined,
                pendingGoalId: undefined,
                pendingGoalTitle: undefined,
                pendingGoalDescription: undefined,
              }
            : sessionPayload;
        await this.stateService.redirectFlow(userId, currentState, redirectedPayload);
      }

      // 6.5 — Enviar ack antes da operação potencialmente lenta
      if (opts.onAck && routingDecision.shouldAck && routingDecision.ackMessage) {
        try {
          await opts.onAck(routingDecision.ackMessage);
        } catch (e) {
          this.logger.debug('onAck callback failed (non-fatal)', e);
        }
      }

      // 7. Chamada secundária ao núcleo roteado
      const secondResult = await runNucleus(currentState);

      // Se o segundo núcleo também recusar e ainda não estamos em clarification,
      // forçar clarification como último fallback (sem roteamento adicional).
      if (
        secondResult.decision === DECISIONS.NOT_MY_JOB &&
        currentState !== FLOW_STATES.CLARIFICATION
      ) {
        currentState = FLOW_STATES.CLARIFICATION;
        const clarResult = await runNucleus(FLOW_STATES.CLARIFICATION);
        const exec = await this.actionExecutor.execute(userId, clarResult.actions, worldId);
        return { kind: 'direct', reply: exec.reply || '', origin: currentState };
      }

      const exec = await this.actionExecutor.execute(userId, secondResult.actions, worldId);
      const reply = exec.reply || (secondResult.decision === DECISIONS.NOT_MY_JOB && currentState === FLOW_STATES.CLARIFICATION
        ? 'Não consegui entender. Pode reformular?'
        : '');
      return { kind: 'direct', reply, origin: currentState };

    } catch (e) {
      this.logger.error('Orchestrator failed', e);
      return { kind: 'direct', reply: 'Algo deu errado. Pode repetir?', origin: 'orchestrator' };
    }
  }
}

export default ConversationOrchestratorService;
