import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';

@Injectable()
export class ProgressService {
  async getWeeklyProgress(userId: string, date: string, areaId?: string) {
    // Calculo mockado ou agregado do prisma
    return {
      period: 'week',
      date,
      areaId: areaId || null,
      completionRate: 65,
      harvested: 13,
      total: 20
    };
  }

  async getMonthlyProgress(userId: string, month: string, areaId?: string) {
    return {
      period: 'month',
      month,
      areaId: areaId || null,
      completionRate: 40,
      activeDays: 15
    };
  }

  async getStreaks(userId: string) {
    return { currentStreak: 5, longestStreak: 12 };
  }
}
