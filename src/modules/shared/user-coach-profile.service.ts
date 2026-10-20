import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';

export type CoachProfileUpdate = {
  preferredTone?: string;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  conversationSummary?: string | null;
};

@Injectable()
export class UserCoachProfileService {
  async getOrCreate(userId: string) {
    const existing = await prisma.userCoachProfile.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return prisma.userCoachProfile.create({
      data: { userId },
    });
  }

  async update(userId: string, data: CoachProfileUpdate) {
    await this.getOrCreate(userId);
    return prisma.userCoachProfile.update({
      where: { userId },
      data: {
        ...(data.preferredTone !== undefined
          ? { preferredTone: data.preferredTone }
          : {}),
        ...(data.quietHoursStart !== undefined
          ? { quietHoursStart: data.quietHoursStart }
          : {}),
        ...(data.quietHoursEnd !== undefined
          ? { quietHoursEnd: data.quietHoursEnd }
          : {}),
        ...(data.conversationSummary !== undefined
          ? { conversationSummary: data.conversationSummary }
          : {}),
      },
    });
  }

  async setConversationSummary(userId: string, summary: string) {
    return this.update(userId, { conversationSummary: summary });
  }

  async getCoachContext(userId: string) {
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          timezone: true,
          currentWorldId: true,
          digestEnabled: true,
          digestTime: true,
        },
      }),
      this.getOrCreate(userId),
    ]);
    return {
      timezone: user?.timezone ?? 'America/Sao_Paulo',
      worldId: user?.currentWorldId ?? 'mundo1',
      digestEnabled: user?.digestEnabled ?? false,
      digestTime: user?.digestTime ?? null,
      preferredTone: profile.preferredTone,
      quietHoursStart: profile.quietHoursStart,
      quietHoursEnd: profile.quietHoursEnd,
      conversationSummary: profile.conversationSummary,
    };
  }
}
