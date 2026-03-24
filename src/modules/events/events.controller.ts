import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';
import { UserGoalService } from '../goals/user-goal.service';
import { AuthGuard } from '../../auth/auth.guard';
import { prisma } from '../../prisma/client';

@ApiTags('Eventos')
@Controller('api/events')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private readonly userGoalService: UserGoalService) {}

  @Get()
  @ApiOperation({ summary: 'Listar eventos do usuário', description: 'Retorna metas do tipo Pontual como Eventos.' })
  @ApiResponse({ status: 200, description: 'Lista de eventos' })
  async getEvents(@Req() req: any) {
    const goals = await this.userGoalService.getGoalsForUser(req.user.userId);
    return goals.filter(g => g.goalType === 'Pontual');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do evento' })
  @ApiResponse({ status: 200, description: 'Detalhes retornados' })
  async getEventById(@Param('id') id: string, @Req() req: any) {
    return prisma.userGoal.findFirst({ where: { id, userId: req.user.userId, goalType: 'Pontual' } });
  }

  @Post()
  @ApiOperation({ summary: 'Criar novo evento' })
  @ApiBody({ schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, worldId: { type: 'string' }, conquestType: { type: 'string', example: 'Trabalho' }, goalType: { type: 'string', example: 'Pontual' } } } })
  @ApiResponse({ status: 201, description: 'Evento criado' })
  async createEvent(@Body() body: any, @Req() req: any) {
    return this.userGoalService.createUserGoalWithTree({ ...body, userId: req.user.userId, goalType: 'Pontual' });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar evento' })
  @ApiResponse({ status: 200, description: 'Evento atualizado' })
  async updateEvent(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return prisma.userGoal.update({ where: { id, goalType: 'Pontual' }, data: body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar evento' })
  @ApiResponse({ status: 200, description: 'Evento deletado' })
  async deleteEvent(@Param('id') id: string, @Req() req: any) {
    return prisma.userGoal.delete({ where: { id, goalType: 'Pontual' } });
  }
}
