import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserGoalService } from '../goals/user-goal.service';
import { TelegramService } from '../telegram/telegram.service';
import { CommunicationService } from '../shared/communication.service';
import { AiService } from '../ia/openIa/ai.service';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { MESSAGES, formatMessage } from '../ia/messages';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly userGoalService: UserGoalService,
    private readonly telegramService: TelegramService,
    private readonly communicationService: CommunicationService,
    private readonly aiService: AiService,
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

      // Usa horário local do usuário para comparações
      const nowLocal = DateTime.now().setZone(tz);

      if (!goal.reminderTime) continue;

      // Agora tratamos dois casos: lembrete pontual (Pontual) ou recorrente (Continua)
      const isPontual = String(goal.goalType || '').toLowerCase() === 'pontual';

      if (isPontual) {
        // Pontual: comparar a datetime exata armazenada, mas em timezone do usuário
        const remDtLocal = DateTime.fromJSDate(new Date(goal.reminderTime)).setZone(tz);
        const windowStartLocal = remDtLocal.minus({ minutes: 10 });
        this.logger.log(`🎯 [REMINDER] (Pontual) Meta: ${goal.title}, reminderLocal: ${remDtLocal.toFormat('HH:mm')}, nowLocal: ${nowLocal.toFormat('HH:mm')} (tz=${tz})`);
        if (!goal.dailyStatus && nowLocal >= windowStartLocal && nowLocal <= remDtLocal) {
          // Persistimos lastReminderSentAt em UTC, mas a decisão é feita em horário local
          await this.sendReminder(goal, DateTime.fromJSDate(nowLocal.toUTC().toJSDate()).toJSDate(), 'SENT');
        } else if ((goal.dailyStatus === 'SENT' || goal.dailyStatus === 'WAITING') && (!goal.silenceUntil || nowLocal >= DateTime.fromJSDate(new Date(goal.silenceUntil)).setZone(tz))) {
          await this.sendReminder(goal, DateTime.fromJSDate(nowLocal.toUTC().toJSDate()).toJSDate(), 'WAITING');
        }
      } else {
        // Recorrente: usamos hora/minuto do reminderTime no timezone do usuário e calculamos ocorrência de hoje
        const remDt = DateTime.fromJSDate(new Date(goal.reminderTime)).setZone(tz);
        const todayLocal = nowLocal.set({ hour: remDt.hour, minute: remDt.minute, second: 0, millisecond: 0 });
        const windowStartLocal = todayLocal.minus({ minutes: 10 });

        this.logger.log(`🎯 [REMINDER] (Recorrente) Meta: ${goal.title}, tz=${tz}, todayLocal=${todayLocal.toFormat('HH:mm')}, nowLocal=${nowLocal.toFormat('HH:mm')}`);

        if (!goal.dailyStatus && nowLocal >= windowStartLocal && nowLocal <= todayLocal) {
          await this.sendReminder(goal, DateTime.fromJSDate(nowLocal.toUTC().toJSDate()).toJSDate(), 'SENT');
        } else if ((goal.dailyStatus === 'SENT' || goal.dailyStatus === 'WAITING') && (!goal.silenceUntil || nowLocal >= DateTime.fromJSDate(new Date(goal.silenceUntil)).setZone(tz))) {
          await this.sendReminder(goal, DateTime.fromJSDate(nowLocal.toUTC().toJSDate()).toJSDate(), 'WAITING');
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
      : formatMessage(MESSAGES.WAITING_MESSAGE, { name: user.name, title: goal.title });

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