import { Injectable } from '@nestjs/common';
import { Goal } from './goals.interface';
import { prisma } from '../prisma/client';  

@Injectable()
export class GoalsService {
  async create(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<Goal> {
    return prisma.goal.create({ data: goal });
  }

  async findAll(): Promise<Goal[]> {
    return prisma.goal.findMany();
  }

  async findOne(id: number): Promise<Goal | null> {
    return prisma.goal.findUnique({ where: { id } });
  }

  async update(id: number, updates: Partial<Goal>): Promise<Goal | null> {
    try {
      return await prisma.goal.update({ where: { id }, data: updates });
    } catch {
      return null;
    }
  }

  async delete(id: number): Promise<Goal | null> {
    try {
      return await prisma.goal.delete({ where: { id } });
    } catch {
      return null;
    }
  }
}
