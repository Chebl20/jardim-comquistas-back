import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import { formatScheduleSummary } from '../shared/schedule-formatter.util';
import { pickGoalEmoji } from '../shared/goal-emoji.util';
import type { ScheduleConfig } from '../../domain/types/schedule-config.type';
import { MessagingService } from '../messaging/messaging.service';

/**
 * Formata o horário/data de uma meta para o resumo diário.
 * Digest-specific: lista TODOS os horários do dia para metas com múltiplos slots
 * (ex: "02:00, 10:00 e 18:00") e usa "hoje/amanhã" para pontual.
 * Para casos não cobertos, delega para formatScheduleSummary.
 */
function formatDigestScheduleLabel(
  goal: {
    goalKind?: string;
    schedule?: ScheduleConfig | null;
  },
  timezone: string,
): string | null {
  const formatTime = (dt: Date | string): string =>
    new Date(dt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });

  const diffDaysLabel = (reminder: Date): string | null => {
    const now = new Date();
    const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const userReminder = new Date(
      reminder.toLocaleString('en-US', { timeZone: timezone }),
    );
    const diffDays = Math.floor(
      (new Date(userReminder).setHours(0, 0, 0, 0) -
        new Date(userNow.toDateString()).getTime()) /
        86400000,
    );
    if (userReminder <= userNow) {
      return diffDays === 0 ? `hoje às ${formatTime(reminder)}` : null;
    }
    const label =
      diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`;
    return `${label} às ${formatTime(reminder)}`;
  };

  const sc = goal.schedule;
  if (sc && typeof sc === 'object') {
    if (sc.type === 'once') {
      return diffDaysLabel(new Date(sc.at));
    }
    if (sc.type === 'daily' || sc.type === 'weekly') {
      if (!sc.times || sc.times.length === 0)
        return formatScheduleSummary(sc, timezone) || null;
      const sorted = [...sc.times].sort((a, b) => {
        const [hA, mA] = a.split(':').map(Number);
        const [hB, mB] = b.split(':').map(Number);
        return hA * 60 + (mA || 0) - (hB * 60 + (mB || 0));
      });
      const timesStr =
        sorted.length > 1
          ? sorted.slice(0, -1).join(', ') + ' e ' + sorted[sorted.length - 1]
          : sorted[0];
      if (sc.type === 'daily' && 'durationDays' in sc && sc.durationDays) {
        return `${sc.durationDays} dias: ${timesStr}`;
      }
      return timesStr;
    }
    return formatScheduleSummary(sc, timezone) || null;
  }

  return null;
}

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
  ) {}

  /**
   * Monta e envia o resumo diário para um usuário.
   * Usado tanto pelo cron quanto pelo gatilho manual "DISPARO DE MSG DIARIA".
   */
  async sendDigestForUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        telegramId: true,
        whatsappId: true,
        preferredChannel: true,
        timezone: true,
      },
    });
    if (!user || !this.messagingService.hasAnyChannel(user)) {
      this.logger.warn(
        `sendDigestForUser: user ${userId} sem canal de mensagem`,
      );
      return null;
    }

    const timezone = user.timezone || 'America/Sao_Paulo';
    const goals = await this.userGoalService.getGoalsForTodayForUser(
      userId,
      timezone,
    );

    const lines: string[] = [];
    const dateStr = DateTime.now()
      .setZone(timezone)
      .toFormat("cccc, d 'de' MMMM", { locale: 'pt-BR' });

    lines.push(`📋 Resumo do seu dia — ${dateStr}`);
    lines.push('');

    if (goals.length === 0) {
      lines.push('Nenhuma meta com lembrete hoje. Aproveite o dia! 🌱');
    } else {
      for (const g of goals) {
        const emoji = pickGoalEmoji(g.conquestType, g.title);
        const when = formatDigestScheduleLabel(g, timezone) || '';
        const suffix = when ? ` — ${when}` : '';
        lines.push(`${emoji} ${g.title}${suffix}`);
      }
    }

    const message = lines.join('\n');
    const sent = await this.messagingService.sendToUser(
      user,
      message,
      'daily-digest',
    );
    if (!sent) {
      this.logger.warn(
        `sendDigestForUser: falha ao enviar para user ${userId}`,
      );
      return null;
    }
    return message;
  }
}
