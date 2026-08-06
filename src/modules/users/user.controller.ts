import { Controller, Post, Get, Param, Body, UnauthorizedException, Patch, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { UserService } from './user.service';
import { signJwt } from '../../auth/auth.guard';
import { AuthGuard } from '../../auth/auth.guard';

@ApiTags('Usuários')
@Controller('api/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Criar usuário', description: 'Registra um novo usuário no sistema.' })
  @ApiBody({ schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, timezone: { type: 'string', example: 'America/Sao_Paulo' } } } })
  @ApiResponse({ status: 201, description: 'Usuário criado com sucesso.' })
  async create(@Body() body: { name: string; email: string; password: string; timezone?: string }, @Req() req: any) {
    const headerTz = req?.headers?.['x-timezone'] || req?.headers?.timezone;
    const tz = body.timezone || headerTz;
    return this.userService.createUser(body.name, body.email, body.password, tz);
  }

  @Get(':id/telegram-linked')
  @ApiOperation({ summary: 'Verificar vinculação Telegram', description: 'Verifica se o usuário possui conta Telegram vinculada.' })
  @ApiResponse({ status: 200, description: 'Status da vinculação.', schema: { type: 'object', properties: { linked: { type: 'boolean' } } } })
  async isTelegramLinked(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    return { linked: !!user?.telegramId };
  }

  @Get(':id/channels-linked')
  @ApiOperation({
    summary: 'Verificar canais vinculados',
    description: 'Verifica se o usuário possui Telegram e/ou WhatsApp vinculados e o canal preferido.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status da vinculação por canal.',
    schema: {
      type: 'object',
      properties: {
        telegramLinked: { type: 'boolean' },
        whatsappLinked: { type: 'boolean' },
        preferredChannel: { type: 'string', nullable: true },
      },
    },
  })
  async isChannelsLinked(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    return {
      telegramLinked: !!user?.telegramId,
      whatsappLinked: !!user?.whatsappId,
      preferredChannel: user?.preferredChannel ?? null,
    };
  }

  @Post('login')
  @ApiOperation({ summary: 'Login', description: 'Autentica o usuário e retorna um token JWT.' })
  @ApiBody({ schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Login realizado com sucesso.', schema: { type: 'object', properties: { message: { type: 'string' }, userId: { type: 'string' }, token: { type: 'string' } } } })
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.userService.validateUser(body.email, body.password);
    const token = signJwt({ userId: user.id, email: user.email });
    return { message: 'Login ok', userId: user.id, token };
  }

  @Patch('me/current-world')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar mundo atual', description: 'Altera o mundo (world) atual do usuário autenticado.' })
  @ApiBody({ schema: { type: 'object', required: ['currentWorldId'], properties: { currentWorldId: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Mundo atualizado.' })
  async updateCurrentWorld(@Body() body: { currentWorldId: string }, @Req() req: any) {
    const userId = req.user.userId;
    await this.userService.updateCurrentWorld(userId, body.currentWorldId);
    return { message: 'Mundo atualizado' };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil do usuário', description: 'Retorna os dados do usuário autenticado.' })
  @ApiResponse({ status: 200, description: 'Dados do perfil do usuário.' })
  async getMe(@Req() req: any) {
    const user = await this.userService.getUserById(req.user.userId);
    if (!user) throw new UnauthorizedException('User not found');
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}