import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { ConversationOrchestratorService } from './conversation/conversation-orchestrator.service';
import { ConversationSessionService } from '../shared/conversation-session.service';

@ApiTags('Guia do Jardim')
@Controller('api/garden-guide')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GardenGuideController {
  constructor(
    private readonly orchestrator: ConversationOrchestratorService,
    private readonly sessionService: ConversationSessionService,
  ) {}

  @Get('conversations')
  @ApiOperation({
    summary: 'Listar conversas do Guia (Sessões)',
    description: 'Retorna a sessão de conversa ativa do usuário autenticado.',
  })
  @ApiResponse({ status: 200, description: 'Sessão ativa ou lista vazia' })
  async getConversations(@Req() req: any) {
    const session = await this.sessionService.getSession(req.user.userId);
    return session ? [session] : [];
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Obter mensagens da sessão' })
  @ApiResponse({ status: 200, description: 'Sessão com payload de mensagens' })
  @ApiResponse({ status: 404, description: 'Sessão não encontrada' })
  async getMessages(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionService.getSession(req.user.userId);
    if (!session || session.id !== id) {
      throw new NotFoundException('Sessão não encontrada');
    }
    return session;
  }

  @Post('conversations/:id/messages')
  @ApiOperation({
    summary: 'Enviar mensagem para o Guia do Jardim',
    description: 'Encaminha a mensagem para o orquestrador de IA e retorna a resposta.',
  })
  @ApiBody({
    schema: { type: 'object', properties: { text: { type: 'string' } } },
  })
  @ApiResponse({ status: 201, description: 'Resposta da IA' })
  async sendMessage(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = String(req.user.userId);
    const output = await this.orchestrator.handle({
      userId,
      text: body.text,
    });
    return { response: output.reply };
  }
}
