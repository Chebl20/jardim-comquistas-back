import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserLinkService } from './user-link.service';
import { TelegramService } from '../telegram/telegram.service';

@ApiTags('Vinculação Telegram')
@Controller('api/users/link')
export class UserLinkController {
  constructor(
    private readonly userLinkService: UserLinkService,
    private readonly telegramService: TelegramService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Gerar código de vinculação', description: 'Gera um código único para vincular a conta ao bot do Telegram.' })
  @ApiBody({ schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } })
  @ApiResponse({ 
  status: 201, 
  description: 'Código gerado com informações do bot.', 
  schema: { 
    type: 'object', 
    properties: { 
      linkCode: { type: 'string' }, 
      botUsername: { type: 'string' },
      botName: { type: 'string' },
      botInfo: { type: 'object' },
      telegramLink: { type: 'string' }
    } 
  } 
})
  async generate(@Body() body: { userId: string }) {
    const code = await this.userLinkService.generateLinkCode(body.userId);
    const botInfo = this.telegramService.getBotInfo();
    const botUsername = this.telegramService.getBotUsername();
    const botName = this.telegramService.getBotName();
    
    return { 
      linkCode: code, 
      botUsername,
      botName,
      botInfo,
      telegramLink: botUsername ? `https://t.me/${botUsername}` : null
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

  @Get('bot-info')
  @ApiOperation({ summary: 'Obter informações do bot', description: 'Retorna informações dinâmicas do bot do Telegram.' })
  @ApiResponse({ 
    status: 200, 
    description: 'Informações do bot.', 
    schema: { 
      type: 'object', 
      properties: { 
        botUsername: { type: 'string' },
        botName: { type: 'string' },
        botInfo: { type: 'object' },
        telegramLink: { type: 'string' }
      } 
    } 
  })
  async getBotInfo() {
    const botInfo = this.telegramService.getBotInfo();
    const botUsername = this.telegramService.getBotUsername();
    const botName = this.telegramService.getBotName();
    
    return { 
      botUsername,
      botName,
      botInfo,
      telegramLink: botUsername ? `https://t.me/${botUsername}` : null
    };
  }
}
