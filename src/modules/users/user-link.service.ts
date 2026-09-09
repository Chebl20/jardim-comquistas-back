import { Injectable } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { randomBytes } from 'crypto';

export type PreferredChannel = 'TELEGRAM' | 'WHATSAPP';

@Injectable()
export class UserLinkService {
  // Gera um código único para o usuário e salva no banco
  async generateLinkCode(userId: string) {
    const code = randomBytes(4).toString('hex');
    await prisma.user.update({
      where: { id: userId },
      data: { linkCode: code },
    });
    return code;
  }

  // Vincula o telegramId ao usuário usando o código
  async linkTelegram(linkCode: string, telegramId: string) {
    const user = await prisma.user.findUnique({ where: { linkCode } });
    if (!user) throw new Error('Código de vinculação inválido');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramId,
        linkCode: null,
        preferredChannel: 'TELEGRAM',
      },
    });
    return user;
  }

  // Vincula o whatsappId (telefone DDI) ao usuário usando o código
  async linkWhatsApp(linkCode: string, whatsappId: string) {
    const normalized = String(whatsappId || '').replace(/\D/g, '');
    if (!normalized) throw new Error('whatsappId inválido');
    const user = await prisma.user.findUnique({ where: { linkCode } });
    if (!user) throw new Error('Código de vinculação inválido');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        whatsappId: normalized,
        linkCode: null,
        preferredChannel: 'WHATSAPP',
      },
    });
    return user;
  }

  async setPreferredChannel(userId: string, channel: PreferredChannel) {
    await prisma.user.update({
      where: { id: userId },
      data: { preferredChannel: channel },
    });
  }

  // Busca usuário pelo telegramId
  async getUserByTelegramId(telegramId: string) {
    return prisma.user.findUnique({ where: { telegramId } });
  }

  // Busca usuário pelo whatsappId
  async getUserByWhatsappId(whatsappId: string) {
    const normalized = String(whatsappId || '').replace(/\D/g, '');
    if (!normalized) return null;
    return prisma.user.findUnique({ where: { whatsappId: normalized } });
  }
}
