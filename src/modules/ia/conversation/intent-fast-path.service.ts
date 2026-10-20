import { Injectable } from '@nestjs/common';
import { FLOW_STATES, FlowState } from './flow.types';

@Injectable()
export class IntentFastPathService {
  resolve(text: string): FlowState | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;

    if (
      /^(status|como est[aã]o|minhas metas|ver metas|listar metas)\b/.test(t) ||
      /\b(status da meta|progresso das metas)\b/.test(t)
    ) {
      return FLOW_STATES.GOAL_STATUS;
    }

    if (
      /^(registrei|fiz|conclu[ií]|marquei|completei)\b/.test(t) ||
      /\b(registrar progresso|marcar como feito|meta feita)\b/.test(t)
    ) {
      return FLOW_STATES.GOAL_PROGRESS;
    }

    if (
      /^(criar meta|nova meta|quero uma meta)\b/.test(t) ||
      /\b(criar uma meta)\b/.test(t)
    ) {
      return FLOW_STATES.GOAL_CREATION;
    }

    return null;
  }
}
