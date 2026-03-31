import { Controller, Get, Post, Patch, Delete, Param, Body, Req, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';
import { UserGoalService } from './user-goal.service';
import { AuthGuard } from '../../auth/auth.guard';
import { prisma } from '../../prisma/client';
import { DateTime } from 'luxon';

@ApiTags('Metas')
@Controller('api/goals')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserGoalController {
  constructor(private readonly userGoalService: UserGoalService) {}

  @Get()
  @ApiOperation({ summary: 'Listar metas do usuário', description: 'Retorna todas as metas (Goals) pertencentes ao usuário autenticado.' })
  @ApiResponse({ status: 200, description: 'Lista de metas' })
  async getGoals(@Req() req: any) {
    return this.userGoalService.getGoalsForUser(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes da meta' })
  @ApiResponse({ status: 200, description: 'Detalhes retornados' })
  async getGoalById(@Param('id') id: string, @Req() req: any) {
    return prisma.goal.findFirst({ where: { id, userId: req.user.userId } });
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova meta' })
  @ApiBody({ schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, worldId: { type: 'string' }, conquestType: { type: 'string', example: 'Corpo' }, goalType: { type: 'string', example: 'Continua' } } } })
  @ApiResponse({ status: 201, description: 'Meta criada' })
  async createGoal(@Body() body: any, @Req() req: any) {
    return this.userGoalService.createUserGoalWithTree({ ...body, userId: req.user.userId });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar meta' })
  @ApiBody({ schema: { type: 'object', properties: { title: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Meta atualizada' })
  async updateGoal(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    // Apenas exemplo (prisma update direto)
    return prisma.goal.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar meta' })
  @ApiResponse({ status: 200, description: 'Meta deletada' })
  async deleteGoal(@Param('id') id: string, @Req() req: any) {
    return prisma.goal.delete({ where: { id } });
  }
}

@ApiTags('Goal Instances')
@Controller('api/goal-instances')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GoalInstanceController {
  constructor(private readonly userGoalService: UserGoalService) {}

  @Get()
  @ApiOperation({ summary: 'Listar instâncias de metas por data' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD no fuso do usuário; omite = hoje' })
  @ApiResponse({ status: 200, description: 'Lista retornada' })
  async getInstances(@Req() req: any, @Query('date') date?: string) {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone && String(user.timezone).trim() ? user.timezone : 'America/Sao_Paulo';
    const datePart = date && String(date).trim() ? String(date).trim().slice(0, 10) : null;
    if (datePart) {
      const d = DateTime.fromISO(datePart, { zone: tz });
      if (!d.isValid) {
        return this.userGoalService.getGoalsForTodayForUser(userId, tz);
      }
      return this.userGoalService.getGoalsForDateForUser(userId, d, tz, { includeCompleted: false });
    }
    return this.userGoalService.getGoalsForTodayForUser(userId, tz);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Concluir instância de uma meta para o dia' })
  @ApiResponse({ status: 201, description: 'Concluída' })
  async completeInstance(@Param('id') id: string) {
    return this.userGoalService.completeGoal(id);
  }
}
