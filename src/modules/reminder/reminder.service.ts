import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserGoalService } from '../goals/user-goal.service';
import { TelegramService } from '../telegram/telegram.service';
import { CommunicationService } from '../shared/communication.service';
import { AiService } from '../ia/openIa/ai.service';
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

      // Normaliza horário do dia em UTC
      const reminderTime = new Date(goal.reminderTime);
      const todayReminder = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), reminderTime.getUTCHours(), reminderTime.getUTCMinutes(), 0));

      // Janela: 10 min antes
      const reminderWindowStart = new Date(todayReminder.getTime() - 10 * 60 * 1000);

      this.logger.log(`🎯 [REMINDER] Meta: ${goal.title}, status: ${goal.dailyStatus}, silenceUntil: ${goal.silenceUntil}, reminder: ${todayReminder}, now: ${now}`);

      // Se nunca foi enviado hoje (dailyStatus null)
      if (!goal.dailyStatus && now >= reminderWindowStart && now <= todayReminder) {
        await this.sendReminder(goal, now, 'SENT');
      }
      // Se SENT ou WAITING e silêncio expirou
      else if ((goal.dailyStatus === 'SENT' || goal.dailyStatus === 'WAITING') && (!goal.silenceUntil || now >= goal.silenceUntil)) {
        await this.sendReminder(goal, now, 'WAITING');
      }
      // DONE ou SKIPPED: não envia
    }
  }

  private async sendReminder(goal: any, now: Date, status: string) {
    const user = await prisma.user.findUnique({
      where: { id: goal.userId },
      select: { id: true, telegramId: true, name: true },
    });

    if (!user?.telegramId) return;

    const message = status === 'SENT'
      ? await this.communicationService.generateReminderMessage(user.id, goal.title)
      : formatMessage(MESSAGES.WAITING_MESSAGE, { name: user.name, title: goal.title });

    try {
      await this.telegramService.send(Number(user.telegramId), message);
      this.logger.log(`Lembrete ${status} enviado para ${user.name} para meta: ${goal.title}`);

      // Atualizar status
      await prisma.userGoal.update({
        where: { id: goal.id },
        data: {
          dailyStatus: status,
          lastReminderSentAt: now,
        //   silenceUntil: new Date(now.getTime() + 20 * 60 * 1000),
          silenceUntil: new Date(now.getTime() + 1 * 60 * 1000), // 1 min para testes
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