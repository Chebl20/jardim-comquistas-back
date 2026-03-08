import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { UserGoalService } from '../goals/user-goal.service';
import { formatScheduleSummary } from '../shared/schedule-formatter.util';
import { pickGoalEmoji } from '../shared/goal-emoji.util';
import type { ScheduleConfig } from '../ia/conversation/flow.types';
import type { TelegramService } from '../telegram/telegram.service';

/**
 * Formata os horários do dia para o resumo diário (chega na manhã).
 * Para metas com múltiplos horários (ex: remédio 3x ao dia), lista TODOS os horários do dia.
 * Ex: "02:00, 10:00 e 18:00" em vez de só "próximo às 18:00".
 */
function formatDigestScheduleLabel(
  goal: { reminderTime?: Date | string | null; goalType?: string; frequency?: number | null; scheduleConfig?: unknown },
  timezone: string,
): string | null {
  const formatTime = (dt: Date | string): string =>
    new Date(dt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });

  const sc = goal.scheduleConfig as ScheduleConfig | undefined;
  if (sc && typeof sc === 'object') {
    if (sc.type === 'once') {
      const reminder = new Date(sc.at);
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const userReminder = new Date(reminder.toLocaleString('en-US', { timeZone: timezone }));
      const diffDays = Math.floor(
        (userReminder.setHours(0, 0, 0, 0) - new Date(userNow.toDateString()).getTime()) / 86400000,
      );
      if (userReminder <= userNow) {
        if (diffDays === 0) return `hoje às ${formatTime(reminder)}`;
        return null;
      }
      const dateLabel = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`;
      return `${dateLabel} às ${formatTime(reminder)}`;
    }
    if (sc.type === 'daily' || sc.type === 'weekly') {
      if (!sc.times || sc.times.length === 0) return null;
      // Ordena horários cronologicamente (02:00, 10:00, 18:00)
      const sorted = [...sc.times].sort((a, b) => {
        const [hA, mA] = a.split(':').map(Number);
        const [hB, mB] = b.split(':').map(Number);
        return (hA * 60 + (mA || 0)) - (hB * 60 + (mB || 0));
      });
      const timesStr = sorted.length > 1 ? sorted.slice(0, -1).join(', ') + ' e ' + sorted[sorted.length - 1] : sorted[0];
      if (sc.type === 'daily' && 'durationDays' in sc && sc.durationDays) {
        return `${sc.durationDays} dias: ${timesStr}`;
      }
      return timesStr;
    }
  }

  // Legado: reminderTime / frequency
  if (!goal.reminderTime) return null;
  try {
    const reminder = new Date(goal.reminderTime);
    const timeStr = formatTime(reminder);
    const goalType = String(goal.goalType || '').toLowerCase();
    const freq = goal.frequency ?? 1;
    if (goalType === 'pontual') {
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const userReminder = new Date(reminder.toLocaleString('en-US', { timeZone: timezone }));
      const diffDays = Math.floor(
        (userReminder.setHours(0, 0, 0, 0) - new Date(userNow.toDateString()).getTime()) / 86400000,
      );
      if (userReminder <= userNow) {
        if (diffDays === 0) return `hoje às ${timeStr}`;
        return null;
      }
      const dateLabel = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`;
      return `${dateLabel} às ${timeStr}`;
    }
    return freq >= 1 ? `às ${timeStr}` : timeStr;
  } catch {
    return null;
  }
}

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Monta e envia o resumo diário para um usuário.
   * Usado tanto pelo cron quanto pelo gatilho manual "DISPARO DE MSG DIARIA".
   */
  async sendDigestForUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, telegramId: true, timezone: true },
    });
    if (!user?.telegramId) {
      this.logger.warn(`sendDigestForUser: user ${userId} sem telegramId`);
      return null;
    }

    const timezone = user.timezone || 'America/Sao_Paulo';
    const goals = await this.userGoalService.getGoalsForTodayForUser(userId, timezone);

    const lines: string[] = [];
    const dateStr = DateTime.now().setZone(timezone).toFormat("cccc, d 'de' MMMM", { locale: 'pt-BR' });

    lines.push(`📋 Resumo do seu dia — ${dateStr}`);
    lines.push('');

    if (goals.length === 0) {
      lines.push('Nenhuma meta com lembrete hoje. Aproveite o dia! 🌱');
    } else {
      for (const g of goals) {
        const emoji = pickGoalEmoji(g.conquestType, g.title);
        const when =
          formatDigestScheduleLabel(g, timezone) ||
          (g.scheduleConfig ? formatScheduleSummary(g.scheduleConfig, timezone) : null) ||
          (g.reminderTime ? new Date(g.reminderTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }) : '');
        const suffix = when ? ` — ${when}` : '';
        lines.push(`${emoji} ${g.title}${suffix}`);
      }
    }

    const message = lines.join('\n');
    // Dynamic import para evitar dependência circular (telegram.service importa daily-digest.service)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../telegram/telegram.service');
    const telegram = this.moduleRef.get(mod.TelegramService as new (...args: unknown[]) => TelegramService, {
      strict: false,
    }) as TelegramService;
    await telegram.sendReply(Number(user.telegramId), message, 'daily-digest');
    return message;
  }
}
