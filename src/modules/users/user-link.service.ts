import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { randomBytes } from 'crypto';

@Injectable()
export class UserLinkService {
  // Gera um código único para o usuário e salva no banco
  async generateLinkCode(userId: string) {
    const code = randomBytes(4).toString('hex');
    await prisma.user.update({ where: { id: userId }, data: { linkCode: code } });
    return code;
  }

  // Vincula o telegramId ao usuário usando o código
  async linkTelegram(linkCode: string, telegramId: string) {
    const user = await prisma.user.findUnique({ where: { linkCode } });
    if (!user) throw new Error('Código de vinculação inválido');
    await prisma.user.update({ where: { id: user.id }, data: { telegramId, linkCode: null } });
    return user;
  }

  // Busca usuário pelo telegramId
  async getUserByTelegramId(telegramId: string) {
    return prisma.user.findUnique({ where: { telegramId } });
  }
}
