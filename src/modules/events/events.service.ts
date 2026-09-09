import { Injectable, NotFoundException } from '@nestjs/common';
import { UserGoalService } from '../goals/user-goal.service';

/** Forma canônica de goalKind para eventos (uppercase, compatível com Prisma enum). */
export const EVENT_GOAL_KIND = 'PONTUAL';

/** Verifica se um goal é um Evento, normalizando variações de capitalização. */
function isEvent(goal: { goalKind?: string | null }): boolean {
  return String(goal.goalKind ?? '').toUpperCase() === EVENT_GOAL_KIND;
}

@Injectable()
export class EventsService {
  constructor(private readonly userGoalService: UserGoalService) {}

  async getEvents(userId: string) {
    const goals = await this.userGoalService.getGoalsForUser(userId);
    return goals.filter(isEvent);
  }

  async getEventById(id: string, userId: string) {
    const goal = await this.userGoalService.getGoalForUser(id, userId);
    if (!goal || !isEvent(goal)) {
      throw new NotFoundException('Evento não encontrado');
    }
    return goal;
  }

  async createEvent(body: Record<string, unknown>, userId: string) {
    return this.userGoalService.createUserGoalWithTree({
      ...body,
      userId,
      goalType: 'Pontual',
    } as any);
  }

  async updateEvent(
    id: string,
    userId: string,
    body: Record<string, unknown>,
  ) {
    await this.getEventById(id, userId);
    return this.userGoalService.updateGoalForUser(id, userId, body);
  }

  async deleteEvent(id: string, userId: string) {
    await this.getEventById(id, userId);
    return this.userGoalService.deleteGoalForUser(id, userId);
  }
}
