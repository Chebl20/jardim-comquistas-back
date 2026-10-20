import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { prisma } from '../../prisma/client';
import * as bcrypt from 'bcryptjs';
import { resolveUserTimezone } from '../shared/app-timezone';
import { normalizeTimezoneFromRequest } from '../shared/user-clock.util';

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
    const tz = normalizeTimezoneFromRequest(timezone);
    if (timezone != null && String(timezone).trim() && !tz) {
      throw new BadRequestException('Fuso horário (timezone) IANA inválido');
    }
    if (tz) data.timezone = tz;
    return prisma.user.create({ data });
  }

  async updateTimezone(userId: string, rawTimezone: string) {
    const tz = normalizeTimezoneFromRequest(rawTimezone);
    if (!tz) {
      throw new BadRequestException('Fuso horário (timezone) IANA inválido');
    }
    return prisma.user.update({
      where: { id: userId },
      data: { timezone: tz },
    });
  }

  async applyTimezoneIfPresent(
    userId: string,
    rawTimezone?: string | null,
  ): Promise<void> {
    const tz = normalizeTimezoneFromRequest(rawTimezone);
    if (!tz) return;
    await prisma.user.update({
      where: { id: userId },
      data: { timezone: tz },
    });
  }

  async getUserTimezoneResolved(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return resolveUserTimezone(user?.timezone);
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
