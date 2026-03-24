import { Controller, Get, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { prisma } from '../../prisma/client';

@ApiTags('Guia do Jardim')
@Controller('api/garden-guide')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GardenGuideController {
  
  @Get('conversations')
  @ApiOperation({ summary: 'Listar conversas do Guia (Sessões)' })
  @ApiResponse({ status: 200, description: 'Lista de sessões' })
  async getConversations(@Req() req: any) {
    return prisma.conversationSession.findMany({ where: { userId: req.user.userId } });
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Obter mensagens da sessão (Mock)' })
  @ApiResponse({ status: 200, description: 'Lista de mensagens' })
  async getMessages(@Param('id') id: string) {
    // Como ConversationSession guarda no Payload/State as mensagens consolidadas...
    const session = await prisma.conversationSession.findUnique({ where: { id } });
    return session || { messages: [] };
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Enviar mensagem pro Guia' })
  @ApiBody({ schema: { type: 'object', properties: { text: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Resposta da IA' })
  async sendMessage(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return { response: 'Esta é uma resposta temporária do Guia do Jardim. A integração com IA principal usa este entrypoint.' };
  }
}
