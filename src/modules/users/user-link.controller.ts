import { Controller, Post, Body, Get, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserLinkService } from './user-link.service';
import { TelegramService } from '../telegram/telegram.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@ApiTags('Vinculação')
@Controller('api/users/link')
export class UserLinkController {
  constructor(
    private readonly userLinkService: UserLinkService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Gerar código de vinculação', description: 'Gera um código único para vincular a conta ao Telegram ou WhatsApp.' })
  @ApiBody({ schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } })
  @ApiResponse({
    status: 201,
    description: 'Código gerado com informações dos canais.',
    schema: {
      type: 'object',
      properties: {
        linkCode: { type: 'string' },
        botUsername: { type: 'string' },
        botName: { type: 'string' },
        botInfo: { type: 'object' },
        telegramLink: { type: 'string' },
        whatsappNumber: { type: 'string' },
        whatsappInstructions: { type: 'string' },
      },
    },
  })
  async generate(@Body() body: { userId: string }) {
    const code = await this.userLinkService.generateLinkCode(body.userId);
    const botInfo = this.telegramService.getBotInfo();
    const botUsername = this.telegramService.getBotUsername();
    const botName = this.telegramService.getBotName();
    const whatsappNumber = this.whatsappService.getBusinessNumber();

    return {
      linkCode: code,
      botUsername,
      botName,
      botInfo,
      telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
      whatsappNumber: whatsappNumber || null,
      whatsappInstructions: whatsappNumber
        ? `Envie o código ${code} no WhatsApp para ${whatsappNumber} para vincular sua conta.`
        : 'Envie o código gerado no WhatsApp do Jardim das Conquistas para vincular sua conta.',
    };
  }

  @Post('telegram')
  @ApiOperation({ summary: 'Vincular Telegram', description: 'Vincula um telegramId ao usuário usando o código de vinculação.' })
  @ApiBody({ schema: { type: 'object', required: ['linkCode', 'telegramId'], properties: { linkCode: { type: 'string' }, telegramId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Vinculação realizada.', schema: { type: 'object', properties: { ok: { type: 'boolean' }, userId: { type: 'string' } } } })
  async linkTelegram(@Body() body: { linkCode: string; telegramId: string }) {
    const user = await this.userLinkService.linkTelegram(body.linkCode, body.telegramId);
    return { ok: true, userId: user.id };
  }

  @Post('whatsapp')
  @ApiOperation({ summary: 'Vincular WhatsApp', description: 'Vincula um whatsappId (telefone com DDI) ao usuário usando o código de vinculação.' })
  @ApiBody({ schema: { type: 'object', required: ['linkCode', 'whatsappId'], properties: { linkCode: { type: 'string' }, whatsappId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Vinculação realizada.', schema: { type: 'object', properties: { ok: { type: 'boolean' }, userId: { type: 'string' } } } })
  async linkWhatsApp(@Body() body: { linkCode: string; whatsappId: string }) {
    const user = await this.userLinkService.linkWhatsApp(body.linkCode, body.whatsappId);
    return { ok: true, userId: user.id };
  }

  @Get('bot-info')
  @ApiOperation({ summary: 'Obter informações dos canais', description: 'Retorna informações do bot Telegram e do WhatsApp.' })
  @ApiResponse({
    status: 200,
    description: 'Informações dos canais.',
    schema: {
      type: 'object',
      properties: {
        botUsername: { type: 'string' },
        botName: { type: 'string' },
        botInfo: { type: 'object' },
        telegramLink: { type: 'string' },
        whatsappNumber: { type: 'string' },
      },
    },
  })
  async getBotInfo() {
    const botInfo = this.telegramService.getBotInfo();
    const botUsername = this.telegramService.getBotUsername();
    const botName = this.telegramService.getBotName();
    const whatsappNumber = this.whatsappService.getBusinessNumber();

    return {
      botUsername,
      botName,
      botInfo,
      telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
      whatsappNumber: whatsappNumber || null,
    };
  }
}
