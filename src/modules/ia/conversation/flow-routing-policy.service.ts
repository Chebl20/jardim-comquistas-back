import { Injectable } from '@nestjs/common';
import { FlowState, FLOW_STATES } from './flow.types';

const ACK_MESSAGES: Partial<Record<FlowState, string>> = {
  GOAL_STATUS: 'Um momento, vou verificar suas metas...',
  REMINDER: 'Verificando seus lembretes...',
};

export interface RoutingDecisionInput {
  currentState: FlowState;
  routerTarget?: string | null;
  routerConfidence?: number;
  availableFlows: Record<FlowState, unknown>;
}

export interface RoutingDecision {
  nextState: FlowState;
  shouldAck: boolean;
  ackMessage?: string;
}

@Injectable()
export class FlowRoutingPolicyService {
  resolve(input: RoutingDecisionInput): RoutingDecision {
    const confidenceValid =
      typeof input.routerConfidence === 'number' &&
      input.routerConfidence >= 0 &&
      input.routerConfidence <= 1;

    const validTarget =
      confidenceValid &&
      input.routerTarget &&
      input.availableFlows[input.routerTarget as FlowState] &&
      input.routerTarget !== input.currentState &&
      (input.routerConfidence ?? 0) >= 0.5;

    const nextState = validTarget
      ? (input.routerTarget as FlowState)
      : FLOW_STATES.CLARIFICATION;

    return {
      nextState,
      shouldAck: Boolean(ACK_MESSAGES[nextState]),
      ackMessage: ACK_MESSAGES[nextState],
    };
  }
}
