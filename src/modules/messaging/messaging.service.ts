import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '../../prisma/client';
import { TelegramService } from '../telegram/telegram.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

export type MessagingChannel = 'TELEGRAM' | 'WHATSAPP';

export type MessagingUser = {
  id: string;
  telegramId?: string | null;
  whatsappId?: string | null;
  preferredChannel?: string | null;
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  async sendToUser(
    userOrId: string | MessagingUser,
    text: string,
    origin?: string,
  ): Promise<boolean> {
    const user =
      typeof userOrId === 'string'
        ? await prisma.user.findUnique({
            where: { id: userOrId },
            select: {
              id: true,
              telegramId: true,
              whatsappId: true,
              preferredChannel: true,
            },
          })
        : userOrId;

    if (!user) {
      this.logger.warn('sendToUser: usuário não encontrado');
      return false;
    }

    const order = this.resolveChannelOrder(user);
    for (const channel of order) {
      try {
        const sent = await this.sendViaChannel(channel, user, text, origin);
        if (sent) return true;
      } catch (e) {
        this.logger.warn(`Falha ao enviar via ${channel}`, e as Error);
      }
    }

    this.logger.warn(
      `sendToUser: nenhum canal disponível para user ${user.id}`,
    );
    return false;
  }

  hasAnyChannel(user: MessagingUser): boolean {
    return Boolean(user.telegramId || user.whatsappId);
  }

  private resolveChannelOrder(user: MessagingUser): MessagingChannel[] {
    const preferred = String(user.preferredChannel || '').toUpperCase();
    if (preferred === 'WHATSAPP') return ['WHATSAPP', 'TELEGRAM'];
    if (preferred === 'TELEGRAM') return ['TELEGRAM', 'WHATSAPP'];
    // Sem preferência: WhatsApp primeiro se vinculado, senão Telegram
    if (user.whatsappId) return ['WHATSAPP', 'TELEGRAM'];
    return ['TELEGRAM', 'WHATSAPP'];
  }

  private async sendViaChannel(
    channel: MessagingChannel,
    user: MessagingUser,
    text: string,
    origin?: string,
  ): Promise<boolean> {
    if (channel === 'TELEGRAM') {
      if (!user.telegramId) return false;
      const res = await this.telegramService.sendReply(
        Number(user.telegramId),
        text,
        origin,
      );
      // null = dedupe (já enviado); undefined = falha → tenta outro canal
      if (res === null) return true;
      return res !== undefined;
    }

    if (channel === 'WHATSAPP') {
      if (!user.whatsappId) return false;
      const res = await this.whatsappService.sendReply(
        user.whatsappId,
        text,
        origin,
      );
      if (res === null) return true;
      return res !== undefined;
    }

    return false;
  }
}
