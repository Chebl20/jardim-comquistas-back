import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';

@Injectable()
export class DashboardService {
  async getDashboardDay(userId: string, date: string, areaId?: string) {
    const goals = await prisma.userGoal.findMany({
      where: {
        userId,
        ...(areaId ? { conquestType: areaId } : {})
      }
    });

    return {
      date,
      areaId: areaId || null,
      goals,
      summary: 'Resumo do dia',
      // Mock de outros campos solicitados no rotas.md
      bloomingToday: [],
      growth: { percentage: 0 },
      careNeeded: [],
      harvestSummary: { collected: 0, total: goals.length },
      guideSuggestions: []
    };
  }

  async getDashboardWeek(userId: string, date: string, areaId?: string) {
    return {
      date,
      areaId: areaId || null,
      weekGrid: [],
      weeklyProgress: { percentage: 0 },
      harvestCount: 0,
      gardenLayers: []
    };
  }

  async getDashboardMonth(userId: string, month: string, areaId?: string) {
    return {
      month,
      areaId: areaId || null,
      monthGrid: [],
      monthlyGoal: { percentage: 0 },
      activeDays: 0,
      monthHighlights: []
    };
  }
}
