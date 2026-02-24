import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserGoalService } from '../goals/user-goal.service';
import { TelegramService } from '../telegram/telegram.service';
import { CommunicationService } from '../shared/communication.service';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
// removed external messages import; use CommunicationService for waiting message

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly telegramService: TelegramService,
    private readonly communicationService: CommunicationService,
  ) {}

  @Cron('0 * * * * *') // A cada minuto para testes - mudar para EVERY_HOUR em produção
  async sendReminders() {
    this.logger.log('🔄 [REMINDER] Iniciando verificação de lembretes...');

    const goals = await this.userGoalService.getActiveGoalsForReminders();
    this.logger.log(`📋 [REMINDER] Encontradas ${goals.length} metas ativas para lembretes`);

    const now = new Date();

    for (const goal of goals) {
      if (goal.completed) {
        this.logger.log(`⏭️ [REMINDER] Meta completada: ${goal.title}`);
        continue;
      }

      if (!goal.reminderTime) continue;

      // Buscar timezone do usuário (fallback Brasília)
      let tz = 'America/Sao_Paulo';
      try {
        const uFull = await prisma.user.findUnique({ where: { id: goal.userId } });
        if (uFull && (uFull as any).timezone) tz = (uFull as any).timezone;
      } catch (e) {
        // ignore
      }

      // Decisão determinística baseada em UTC: se o reminderUtc já passou e não foi enviado, então enviar.
      const nowUtc = DateTime.now().toUTC();
      const maxDelaySec = Number(process.env.REMINDER_MAX_DELAY_SEC || 120);

      const isPontual = String(goal.goalType || '').toLowerCase() === 'pontual';

      if (isPontual) {
        // Pontual: comparar datetime exata (UTC)
        const remDtUtc = DateTime.fromJSDate(new Date(goal.reminderTime)).toUTC();
        const diffSec = nowUtc.diff(remDtUtc, 'seconds').seconds;
        this.logger.log(`🎯 [REMINDER] (Pontual) goal=${goal.title} remUtc=${remDtUtc.toISO()} nowUtc=${nowUtc.toISO()} diffSec=${Math.round(diffSec)} tz=${tz}`);

        if (!goal.lastReminderSentAt && diffSec >= 0 && diffSec <= maxDelaySec) {
          // marcar atomically como enviado apenas se lastReminderSentAt ainda é null
          const markNow = nowUtc.toJSDate();
          const silenceUntil = nowUtc.plus({ minutes: 1 }).toJSDate();
          const updateRes = await prisma.userGoal.updateMany({ where: { id: goal.id, lastReminderSentAt: null }, data: { dailyStatus: 'SENT', lastReminderSentAt: markNow, silenceUntil } });
          if (updateRes.count === 1) {
            try {
              await this.sendReminderMessageOnly(goal);
              this.logger.log(`✅ [REMINDER] Sent for goal=${goal.id}`);
            } catch (e) {
              this.logger.error('Erro no envio após marcação, revertendo...', e);
              try { await prisma.userGoal.update({ where: { id: goal.id }, data: { dailyStatus: null, lastReminderSentAt: null, silenceUntil: null } }); } catch (e2) { this.logger.error('Falha ao reverter marcação', e2); }
            }
          } else {
            this.logger.log(`ℹ️ [REMINDER] Já marcado por outro processo: goal=${goal.id}`);
          }
        } else if (goal.lastReminderSentAt) {
          // Possível fila de espera (WAITING) após silenceUntil
          const nowLocal = DateTime.now().setZone(tz);
          if ((goal.dailyStatus === 'SENT' || goal.dailyStatus === 'WAITING') && (!goal.silenceUntil || nowLocal >= DateTime.fromJSDate(new Date(goal.silenceUntil)).setZone(tz))) {
            await this.sendReminder(goal, DateTime.fromJSDate(nowUtc.toJSDate()).toJSDate(), 'WAITING');
          }
        }
      } else {
        // Recorrente: calcular ocorrência de hoje no timezone do usuário e converter para UTC
        const remDtLocal = DateTime.fromJSDate(new Date(goal.reminderTime)).setZone(tz);
        const todayLocal = DateTime.now().setZone(tz).set({ hour: remDtLocal.hour, minute: remDtLocal.minute, second: 0, millisecond: 0 });
        const remDtUtc = todayLocal.toUTC();
        const diffSec = nowUtc.diff(remDtUtc, 'seconds').seconds;
        this.logger.log(`🔁 [REMINDER] (Recorrente) goal=${goal.title} remLocal=${todayLocal.toISO()} remUtc=${remDtUtc.toISO()} nowUtc=${nowUtc.toISO()} diffSec=${Math.round(diffSec)} tz=${tz}`);

        if (!goal.lastReminderSentAt && diffSec >= 0 && diffSec <= maxDelaySec) {
          const markNow = nowUtc.toJSDate();
          const silenceUntil = nowUtc.plus({ minutes: 1 }).toJSDate();
          const updateRes = await prisma.userGoal.updateMany({ where: { id: goal.id, lastReminderSentAt: null }, data: { dailyStatus: 'SENT', lastReminderSentAt: markNow, silenceUntil } });
          if (updateRes.count === 1) {
            try {
              await this.sendReminderMessageOnly(goal);
              this.logger.log(`✅ [REMINDER] Sent (recorrente) for goal=${goal.id}`);
            } catch (e) {
              this.logger.error('Erro no envio recorrente após marcação, revertendo...', e);
              try { await prisma.userGoal.update({ where: { id: goal.id }, data: { dailyStatus: null, lastReminderSentAt: null, silenceUntil: null } }); } catch (e2) { this.logger.error('Falha ao reverter marcação', e2); }
            }
          } else {
            this.logger.log(`ℹ️ [REMINDER] Já marcado por outro processo (recorrente): goal=${goal.id}`);
          }
        } else if (goal.lastReminderSentAt) {
          const nowLocal = DateTime.now().setZone(tz);
          if ((goal.dailyStatus === 'SENT' || goal.dailyStatus === 'WAITING') && (!goal.silenceUntil || nowLocal >= DateTime.fromJSDate(new Date(goal.silenceUntil)).setZone(tz))) {
            await this.sendReminder(goal, DateTime.fromJSDate(nowUtc.toJSDate()).toJSDate(), 'WAITING');
          }
        }
      }
      // DONE ou SKIPPED: não envia
    }
  }

  private async sendReminder(goal: any, now: Date, status: string) {
    const user = await prisma.user.findUnique({
      where: { id: goal.userId },
      select: { id: true, telegramId: true, name: true },
    });

    if (!user?.telegramId) {
      this.logger.warn(`⚠️ [REMINDER] Usuário sem telegramId, não foi possível enviar reminder para userId=${goal.userId}, goalId=${goal.id}`);
      return;
    }

    const message = status === 'SENT'
      ? await this.communicationService.generateReminderMessage(user.id, goal.title)
      : this.communicationService.generateWaitingMessage(user.name, goal.title);

    try {
      await this.telegramService.send(Number(user.telegramId), message);
      this.logger.log(`Lembrete ${status} enviado para ${user.name} para meta: ${goal.title}`);

      // Atualizar status (usar UTC)
      await prisma.userGoal.update({
        where: { id: goal.id },
        data: {
          dailyStatus: status,
          lastReminderSentAt: DateTime.fromJSDate(new Date(now)).toUTC().toJSDate(),
          silenceUntil: DateTime.fromJSDate(new Date(now)).toUTC().plus({ minutes: 1 }).toJSDate(), // 1 min para testes
        },
      });
    } catch (error) {
      this.logger.error(`Erro ao enviar lembrete:`, error);
    }
  }

  // Sends the reminder message without updating DB (DB should be updated atomically before calling this).
  private async sendReminderMessageOnly(goal: any) {
    const user = await prisma.user.findUnique({ where: { id: goal.userId }, select: { id: true, telegramId: true, name: true } });
    if (!user?.telegramId) {
      this.logger.warn(`⚠️ [REMINDER] Usuário sem telegramId, não foi possível enviar reminder para userId=${goal.userId}, goalId=${goal.id}`);
      throw new Error('No telegramId');
    }
    const message = await this.communicationService.generateReminderMessage(user.id, goal.title);
    await this.telegramService.send(Number(user.telegramId), message);
    this.logger.log(`Lembrete enviado (message-only) para ${user.name} para meta: ${goal.title}`);
  }

  @Cron('0 0 * * *') // Reset diário às 00:00
  async resetDailyStatus() {
    this.logger.log('🔄 [REMINDER] Resetando status diário...');
    await prisma.userGoal.updateMany({
      where: { completed: false },
      data: {
        dailyStatus: null,
        silenceUntil: null,
      },
    });
    this.logger.log('✅ [REMINDER] Status diário resetado');
  }
}