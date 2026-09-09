import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { EventsService } from './events.service';

@ApiTags('Eventos')
@Controller('api/events')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar eventos do usuário',
    description: 'Retorna metas do tipo Pontual como Eventos.',
  })
  @ApiResponse({ status: 200, description: 'Lista de eventos' })
  async getEvents(@Req() req: any) {
    return this.eventsService.getEvents(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do evento' })
  @ApiResponse({ status: 200, description: 'Detalhes retornados' })
  @ApiResponse({ status: 404, description: 'Evento não encontrado' })
  async getEventById(@Param('id') id: string, @Req() req: any) {
    return this.eventsService.getEventById(id, req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar novo evento' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        worldId: { type: 'string' },
        conquestType: { type: 'string', example: 'Trabalho' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Evento criado' })
  async createEvent(@Body() body: any, @Req() req: any) {
    return this.eventsService.createEvent(body, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar evento' })
  @ApiResponse({ status: 200, description: 'Evento atualizado' })
  @ApiResponse({ status: 404, description: 'Evento não encontrado' })
  async updateEvent(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.eventsService.updateEvent(id, req.user.userId, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deletar evento' })
  @ApiResponse({ status: 200, description: 'Evento deletado' })
  @ApiResponse({ status: 404, description: 'Evento não encontrado' })
  async deleteEvent(@Param('id') id: string, @Req() req: any) {
    return this.eventsService.deleteEvent(id, req.user.userId);
  }
}
