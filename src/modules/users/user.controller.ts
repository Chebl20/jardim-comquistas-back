import { Controller, Post, Get, Param, Body, UnauthorizedException, Patch, UseGuards, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { signJwt } from '../../auth/auth.guard';
import { AuthGuard } from '../../auth/auth.guard';

@Controller('api/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async create(@Body() body: { name: string; email: string; password: string; timezone?: string }, @Req() req: any) {
    const headerTz = req?.headers?.['x-timezone'] || req?.headers?.timezone;
    const tz = body.timezone || headerTz;
    return this.userService.createUser(body.name, body.email, body.password, tz);
  }

  @Get(':id/telegram-linked')
  async isTelegramLinked(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    return { linked: !!user?.telegramId };
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.userService.validateUser(body.email, body.password);
    const token = signJwt({ userId: user.id, email: user.email });
    return { message: 'Login ok', userId: user.id, token };
  }

  @Patch('me/current-world')
  @UseGuards(AuthGuard)
  async updateCurrentWorld(@Body() body: { currentWorldId: string }, @Req() req: any) {
    const userId = req.user.userId;
    await this.userService.updateCurrentWorld(userId, body.currentWorldId);
    return { message: 'Mundo atualizado' };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@Req() req: any) {
    const user = await this.userService.getUserById(req.user.userId);
    if (!user) throw new UnauthorizedException('User not found');
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}