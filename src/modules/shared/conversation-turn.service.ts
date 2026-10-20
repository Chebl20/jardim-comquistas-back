import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { prisma } from '../../prisma/client';
import type { Action } from '../ia/conversation/flow.types';

export type ConversationChannel = 'TELEGRAM' | 'WHATSAPP' | 'APP';
export type TurnDirection = 'INBOUND' | 'OUTBOUND';

export type LogTurnInput = {
  userId: string;
  channel: ConversationChannel;
  direction: TurnDirection;
  text?: string;
  flowState?: string;
  nucleus?: string;
  actions?: Action[];
  goalId?: string;
  reminderId?: string;
  llmModel?: string;
  confidence?: number;
  externalMsgId?: string;
};

@Injectable()
export class ConversationTurnService {
  private readonly logger = new Logger(ConversationTurnService.name);

  private retentionDays(): number {
    const n = Number(process.env.CONVERSATION_TURN_RETENTION_DAYS || 365);
    return Number.isFinite(n) && n > 0 ? n : 365;
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private expiresAt(): Date {
    const d = new Date();
    d.setDate(d.getDate() + this.retentionDays());
    return d;
  }

  async logTurn(input: LogTurnInput): Promise<string | null> {
    try {
      const text = input.text?.trim();
      const row = await prisma.conversationTurn.create({
        data: {
          userId: input.userId,
          channel: input.channel,
          direction: input.direction,
          flowState: input.flowState ?? null,
          nucleus: input.nucleus ?? null,
          text: text || null,
          textHash: text ? this.hashText(text) : null,
          actions: input.actions ? (input.actions as object) : undefined,
          goalId: input.goalId ?? null,
          reminderId: input.reminderId ?? null,
          llmModel: input.llmModel ?? null,
          confidence: input.confidence ?? null,
          externalMsgId: input.externalMsgId ?? null,
          expiresAt: this.expiresAt(),
        },
        select: { id: true },
      });
      return row.id;
    } catch (e) {
      this.logger.warn('logTurn failed', e);
      return null;
    }
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number; before?: Date },
  ) {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    return prisma.conversationTurn.findMany({
      where: {
        userId,
        ...(opts?.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async purgeExpired(): Promise<number> {
    const res = await prisma.conversationTurn.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return res.count;
  }

  async exportForUser(userId: string) {
    return prisma.conversationTurn.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const res = await prisma.conversationTurn.deleteMany({ where: { userId } });
    return res.count;
  }

  async wasExternalMessageProcessed(externalMsgId: string): Promise<boolean> {
    if (!externalMsgId?.trim()) return false;
    const found = await prisma.conversationTurn.findFirst({
      where: { externalMsgId, direction: 'INBOUND' },
      select: { id: true },
    });
    return Boolean(found);
  }
}
