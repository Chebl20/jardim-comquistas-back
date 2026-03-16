import { Injectable, Logger } from '@nestjs/common';
import { ConversationSessionService } from '../../shared/conversation-session.service';
import { FlowState, FLOW_STATES } from './flow.types';

const RECENT_MESSAGES_PERSIST = 6;

export interface LoadedConversationState {
  session: Awaited<ReturnType<ConversationSessionService['getSession']>>;
  payload: Record<string, any>;
  state: FlowState;
}

@Injectable()
export class ConversationStateService {
  private readonly logger = new Logger(ConversationStateService.name);

  constructor(private readonly sessionService: ConversationSessionService) {}

  async load(userId: string): Promise<LoadedConversationState> {
    const session = await this.sessionService.getSession(userId);
    const payload: Record<string, any> =
      session?.payload && typeof session.payload === 'object' ? { ...(session.payload as object) } : {};
    const rawState = (session?.state ?? FLOW_STATES.CLARIFICATION) as FlowState;
    return {
      session,
      payload,
      state: rawState,
    };
  }

  async appendUserMessage(userId: string, text: string, currentSession?: { state?: string; payload?: any } | null) {
    if (!text.trim()) return;
    try {
      const session = currentSession ?? (await this.sessionService.getSession(userId));
      const payload: Record<string, any> =
        session?.payload && typeof session.payload === 'object' ? { ...(session.payload as object) } : {};
      const recent = Array.isArray(payload.recentMessages) ? [...payload.recentMessages] : [];
      recent.push({ role: 'user', text });
      const truncated = recent.slice(-RECENT_MESSAGES_PERSIST);
      const updatedPayload = { ...payload, recentMessages: truncated };
      if (session) {
        await this.sessionService.updateSession(userId, { payload: updatedPayload });
      } else {
        await this.sessionService.createSession(userId, FLOW_STATES.CLARIFICATION, updatedPayload);
      }
      return updatedPayload;
    } catch (e) {
      this.logger.debug('Failed to append user message to session recentMessages', e);
      return undefined;
    }
  }

  async appendAssistantMessage(userId: string, text: string) {
    try {
      const session = await this.sessionService.getSession(userId);
      const payload: Record<string, any> =
        session?.payload && typeof session.payload === 'object' ? { ...(session.payload as object) } : {};
      const recent = Array.isArray(payload.recentMessages) ? [...payload.recentMessages] : [];
      recent.push({ role: 'assistant', text });
      const truncated = recent.slice(-RECENT_MESSAGES_PERSIST);
      if (session) {
        await this.sessionService.updateSession(userId, {
          payload: { ...payload, recentMessages: truncated },
        });
      } else {
        await this.sessionService.createSession(userId, FLOW_STATES.CLARIFICATION, {
          ...payload,
          recentMessages: truncated,
        });
      }
    } catch (e) {
      this.logger.debug('Failed to append assistant reply to session recentMessages', e);
    }
  }

  async continueFlow(userId: string, payload: Record<string, unknown>, to?: FlowState) {
    const sess = await this.sessionService.getSession(userId);
    const base: Record<string, unknown> =
      sess?.payload && typeof sess.payload === 'object' ? (sess.payload as Record<string, unknown>) : {};
    const newState = to ?? (sess?.state as FlowState | undefined) ?? FLOW_STATES.CLARIFICATION;
    await this.sessionService.updateSessionVersioned(
      userId,
      {
        state: newState,
        payload: { ...base, ...payload },
      },
      sess?.version ?? 0,
    );
  }

  async redirectFlow(userId: string, to: FlowState, payload?: Record<string, unknown>) {
    const sess = await this.sessionService.getSession(userId);
    const base: Record<string, unknown> =
      sess?.payload && typeof sess.payload === 'object' ? (sess.payload as Record<string, unknown>) : {};
    await this.sessionService.updateSessionVersioned(
      userId,
      {
        state: to,
        payload: {
          ...base,
          ...(payload ?? {}),
          messages: Array.isArray(base.messages) ? base.messages : [],
          recentMessages: Array.isArray(base.recentMessages) ? base.recentMessages : [],
        },
      },
      sess?.version ?? 0,
    );
  }

  async resetFlow(userId: string) {
    const sess = await this.sessionService.getSession(userId);
    const base: Record<string, unknown> =
      sess?.payload && typeof sess.payload === 'object' ? (sess.payload as Record<string, unknown>) : {};
    await this.sessionService.updateSessionVersioned(
      userId,
      {
        state: FLOW_STATES.CLARIFICATION,
        payload: {
          messages: Array.isArray(base.messages) ? base.messages : [],
          recentMessages: Array.isArray(base.recentMessages) ? base.recentMessages : [],
        },
      },
      sess?.version ?? 0,
    );
  }
}
