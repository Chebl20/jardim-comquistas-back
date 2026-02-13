import { Controller, Post, Get, Param, Body, UnauthorizedException } from '@nestjs/common';
import { UserService } from './user.service';
import { signJwt } from '../auth/auth.guard';

@Controller('api/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async create(@Body() body: { name: string; email: string; password: string }) {
    return this.userService.createUser(body.name, body.email, body.password);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.userService.validateUser(body.email, body.password);
    const token = signJwt({ userId: user.id, email: user.email });
    return { message: 'Login ok', userId: user.id, token };
  }
}
