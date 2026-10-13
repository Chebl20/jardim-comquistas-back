import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput } from '../nucleus.interface';
import { FlowState, FLOW_STATES } from '../../conversation/flow.types';
import { nucleusRegistry } from '../../conversation/nucleus-registry';
import { ConversationAIService } from '../../conversation-ai.service';
import { ROUTER_PROMPT } from './prompt';

export interface RouterResult {
  target: FlowState | null;
  confidence: number;
}

// RouterNucleus é um serviço de infraestrutura do orquestrador — NÃO implementa
// a interface Nucleus porque retorna RouterResult (não FlowResult).
// Deve ser tratado como um utilitário interno, não como um núcleo de domínio.
@Injectable()
export class RouterNucleus {
  public static PROMPT = ROUTER_PROMPT;
  private readonly logger = new Logger(RouterNucleus.name);

  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<RouterResult> {
    // the router prompt asks the LLM to classify the domain and return a
    // JSON with { target: "FLOW_STATE" | null, confidence: number }
    const systemPrompt = ROUTER_PROMPT(
      input.currentSession || FLOW_STATES.CLARIFICATION,
      input.meta || {},
    );
    let aiRes;
    try {
      aiRes = await this.llm.analyze(
        {
          currentState: input.currentSession || FLOW_STATES.CLARIFICATION,
          payload: input.meta || {},
          userMessage: input.text || '',
        },
        systemPrompt,
      );
    } catch (e) {
      this.logger.warn(
        'Router LLM format error, defaulting to clarification',
        e,
      );
      return { target: FLOW_STATES.CLARIFICATION, confidence: 1 };
    }

    this.logger.debug(`router LLM raw result: ${JSON.stringify(aiRes)}`);

    let target: FlowState | null = null;
    // confidence inválida: degradar graciosamente em vez de derrubar o fluxo
    if (
      typeof aiRes.confidence !== 'number' ||
      aiRes.confidence < 0 ||
      aiRes.confidence > 1
    ) {
      this.logger.warn(
        `Router returned invalid confidence ${aiRes.confidence}, defaulting to clarification`,
      );
      return { target: FLOW_STATES.CLARIFICATION, confidence: 0 };
    }

    if (aiRes.target && typeof aiRes.target === 'string') {
      const raw = aiRes.target as string;

      // try direct match first (already canonical)
      if (nucleusRegistry[raw as FlowState]) {
        target = raw as FlowState;
      } else {
        // normalize common LLM variants to FlowState (be explicit)
        const norm = raw.toLowerCase().replace(/[^a-z]/g, '');
        const mapping: Record<string, FlowState> = {
          goalcreation: FLOW_STATES.GOAL_CREATION,
          creategoal: FLOW_STATES.GOAL_CREATION,
          goalcreationn: FLOW_STATES.GOAL_CREATION,
          goalstatus: FLOW_STATES.GOAL_STATUS,
          status: FLOW_STATES.GOAL_STATUS,
          clarification: FLOW_STATES.CLARIFICATION,
          clarify: FLOW_STATES.CLARIFICATION,
          reminder: FLOW_STATES.REMINDER,
          remind: FLOW_STATES.REMINDER,
          idle: FLOW_STATES.CLARIFICATION,
        };

        if (mapping[norm] && nucleusRegistry[mapping[norm]]) {
          target = mapping[norm];
        } else {
          // fallback: try to coerce into uppercased FlowState form
          const candUpper = raw.toUpperCase().replace(/[^A-Z_]/g, '_');
          if (nucleusRegistry[candUpper as FlowState]) {
            target = candUpper as FlowState;
          } else {
            this.logger.warn(`Router proposed invalid target ${raw}`);
          }
        }
      }
    }

    return { target, confidence: aiRes.confidence };
  }
}
