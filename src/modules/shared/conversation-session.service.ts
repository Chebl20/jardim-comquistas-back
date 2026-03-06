import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';

@Injectable()
export class ConversationSessionService {
  private readonly logger = new Logger(ConversationSessionService.name);
  // default TTL minutes
  private readonly defaultTtlMin = Number(process.env.CONVERSATION_SESSION_TTL_MIN || 10);

  async createSession(userId: string, state: string, payload: any = {}, ttlMin?: number) {
    const expiresAt = DateTime.now().plus({ minutes: ttlMin ?? this.defaultTtlMin }).toUTC().toJSDate();
    try {
      // upsert single session per user
      return prisma.conversationSession.upsert({
        where: { userId },
        update: { state, payload, expiresAt },
        create: { userId, state, payload, expiresAt },
      });
    } catch (e) {
      this.logger.warn('createSession upsert failed', e);
      throw e;
    }
  }

  async getSession(userId: string) {
    return prisma.conversationSession.findUnique({ where: { userId } });
  }

  async updateSession(userId: string, data: { state?: string; payload?: any; expiresAt?: Date }) {
    const update: any = {};
    if (data.state) update.state = data.state;
    if (data.payload) update.payload = data.payload;
    if (data.expiresAt) update.expiresAt = data.expiresAt;
    return prisma.conversationSession.update({ where: { userId }, data: update });
  }

  async upsertSessionState(
    userId: string,
    state: string,
    payloadPatch: Record<string, any> = {},
    ttlMin?: number,
  ) {
    const current = await this.getSession(userId);
    const basePayload =
      current?.payload && typeof current.payload === 'object'
        ? { ...(current.payload as object) }
        : {};
    const expiresAt = DateTime.now()
      .plus({ minutes: ttlMin ?? this.defaultTtlMin })
      .toUTC()
      .toJSDate();

    return prisma.conversationSession.upsert({
      where: { userId },
      update: {
        state,
        payload: { ...basePayload, ...payloadPatch },
        expiresAt,
      },
      create: {
        userId,
        state,
        payload: payloadPatch,
        expiresAt,
      },
    });
  }

  // optimistic versioned update - throws if version mismatch
  async updateSessionVersioned(
    userId: string,
    data: { state?: string; payload?: any; expiresAt?: Date },
    expectedVersion: number,
  ) {
    const session = await this.getSession(userId);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.version !== expectedVersion) {
      throw new Error('Session version conflict');
    }
    const update: any = {};
    if (data.state) update.state = data.state;
    if (data.payload) update.payload = data.payload;
    if (data.expiresAt) update.expiresAt = data.expiresAt;
    update.version = expectedVersion + 1;
    return prisma.conversationSession.update({ where: { userId }, data: update });
  }

  async touchSession(userId: string, extraMin?: number) {
    const s = await this.getSession(userId);
    if (!s) return null;
    const expiresAt = DateTime.fromJSDate(s.expiresAt).plus({ minutes: extraMin ?? this.defaultTtlMin }).toUTC().toJSDate();
    return prisma.conversationSession.update({ where: { userId }, data: { expiresAt } });
  }

  async deleteSession(userId: string) {
    try {
      return prisma.conversationSession.delete({ where: { userId } });
    } catch (e) {
      return null;
    }
  }

  // cleanup expired sessions (can be called by a cron job)
  async cleanupExpired() {
    const now = DateTime.now().toUTC().toJSDate();
    return prisma.conversationSession.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}

export default ConversationSessionService;
