import { Injectable, UnauthorizedException } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  async createUser(
    name: string,
    email: string,
    password: string,
    timezone?: string,
  ) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const data: any = {
      name,
      email,
      password: hashedPassword,
      currentWorldId: 'mundo2',
    };
    if (timezone) data.timezone = timezone;
    return prisma.user.create({ data });
  }

  async getUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: { goals: true },
    });
  }

  async getUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async updateCurrentWorld(userId: string, currentWorldId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { currentWorldId },
    });
  }

  async deleteUser(userId: string) {
    return prisma.user.delete({ where: { id: userId } });
  }

  async validateUser(email: string, password: string) {
    const user = await this.getUserByEmail(email);
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Senha incorreta');
    return user;
  }
}
