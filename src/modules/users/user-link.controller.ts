import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserLinkService } from './user-link.service';

@ApiTags('Vinculação Telegram')
@Controller('api/users/link')
export class UserLinkController {
  constructor(private readonly userLinkService: UserLinkService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Gerar código de vinculação', description: 'Gera um código único para vincular a conta ao bot do Telegram.' })
  @ApiBody({ schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Código gerado.', schema: { type: 'object', properties: { linkCode: { type: 'string' }, botUsername: { type: 'string' } } } })
  async generate(@Body() body: { userId: string }) {
    const code = await this.userLinkService.generateLinkCode(body.userId);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
    return { linkCode: code, botUsername };
  }

  @Post('telegram')
  @ApiOperation({ summary: 'Vincular Telegram', description: 'Vincula um telegramId ao usuário usando o código de vinculação.' })
  @ApiBody({ schema: { type: 'object', required: ['linkCode', 'telegramId'], properties: { linkCode: { type: 'string' }, telegramId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Vinculação realizada.', schema: { type: 'object', properties: { ok: { type: 'boolean' }, userId: { type: 'string' } } } })
  async linkTelegram(@Body() body: { linkCode: string; telegramId: string }) {
    const user = await this.userLinkService.linkTelegram(body.linkCode, body.telegramId);
    return { ok: true, userId: user.id };
  }
}
