import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { ConversationAIService } from '../ia/conversation-ai.service';
import { UserGoalService } from '../goals/user-goal.service';
import { resolveUserTimezone } from '../shared/app-timezone';
import { DAILY_NOTE_PROMPT } from './prompt';
import { buildDailyNoteFacts, factsAllowCare, type DailyNoteFacts } from './daily-note.context';
import { parseDailyNoteText } from './phrases';

const WINDOW_DAYS = 7;

export interface DailyNoteResponse {
  date: string;
  reflection: string | null;
  care: string | null;
}

@Injectable()
export class DailyNoteService {
  private readonly logger = new Logger(DailyNoteService.name);

  constructor(
    private readonly goals: UserGoalService,
    private readonly llm: ConversationAIService,
  ) {}

  async getToday(userId: string): Promise<DailyNoteResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, timezone: true },
    });
    const timezone = resolveUserTimezone(user?.timezone);
    const civilDate =
      DateTime.now().setZone(timezone).toISODate() ||
      DateTime.now().toISODate() ||
      '';

    const existing = await prisma.dailyNote.findUnique({
      where: { userId_civilDate: { userId, civilDate } },
    });
    if (existing) {
      return {
        date: existing.civilDate,
        reflection: existing.reflection,
        care: existing.care,
      };
    }

    const recentNotes = await this.recentNotes(userId, civilDate, timezone);
    const facts = await buildDailyNoteFacts(this.goals, {
      userId,
      name: user?.name?.trim() || 'você',
      timezone,
      civilDate,
      recentNotes,
    });

    const generated = await this.generate(facts);
    if (!generated) {
      return { date: facts.civilDate, reflection: null, care: null };
    }

    try {
      const saved = await prisma.dailyNote.create({
        data: {
          userId,
          civilDate: facts.civilDate,
          reflection: generated.reflection,
          care: generated.care,
        },
      });
      await this.dropOlderThanWindow(userId, facts.civilDate, timezone);
      return {
        date: saved.civilDate,
        reflection: saved.reflection,
        care: saved.care,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await prisma.dailyNote.findUnique({
          where: { userId_civilDate: { userId, civilDate: facts.civilDate } },
        });
        if (raced) {
          return {
            date: raced.civilDate,
            reflection: raced.reflection,
            care: raced.care,
          };
        }
      }
      this.logger.error(`Falha ao gravar o recado de ${facts.civilDate}`, error);
      return { date: facts.civilDate, reflection: null, care: null };
    }
  }

  private async recentNotes(userId: string, civilDate: string, timezone: string) {
    const start = DateTime.fromISO(civilDate, { zone: timezone })
      .minus({ days: WINDOW_DAYS })
      .toISODate();
    if (!start) return [];
    const rows = await prisma.dailyNote.findMany({
      where: { userId, civilDate: { gte: start, lt: civilDate } },
      orderBy: { civilDate: 'asc' },
    });
    return rows.map((row) => ({
      date: row.civilDate,
      reflection: row.reflection,
      care: row.care,
    }));
  }

  private async dropOlderThanWindow(
    userId: string,
    civilDate: string,
    timezone: string,
  ) {
    const start = DateTime.fromISO(civilDate, { zone: timezone })
      .minus({ days: WINDOW_DAYS })
      .toISODate();
    if (!start) return;
    await prisma.dailyNote.deleteMany({
      where: { userId, civilDate: { lt: start } },
    });
  }

  private async generate(facts: Awaited<ReturnType<typeof buildDailyNoteFacts>>) {
    const allowCare = factsAllowCare(facts);
    const user = `Fatos de hoje, em JSON:\n${JSON.stringify(facts)}`;
    const retryUser = `${user}\n\nA resposta anterior foi recusada. Reescreva em português do Brasil, em dica geral, sem citar meta, área, jardim ou o que foi e o que não foi feito, e sem repetir recentNotes.`;

    for (const message of [user, retryUser]) {
      try {
        const raw = await this.llm.completeJson({
          system: DAILY_NOTE_PROMPT,
          user: message,
          temperature: 0.4,
        });
        const parsed = parseDailyNoteText(raw, allowCare, forbiddenTerms(facts));
        if (parsed) return parsed;
        this.logger.warn('Recado do dia rejeitado pelo formato ou pelo idioma');
      } catch (error) {
        this.logger.warn(
          `Recado do dia falhou na chamada ao modelo: ${error instanceof Error ? error.message : 'erro'}`,
        );
      }
    }
    return null;
  }
}

const ORDINARY_AREAS = new Set([
  'corpo',
  'mente',
  'familia',
  'família',
  'trabalho',
  'saude',
  'saúde',
  'lazer',
  'hobby',
  'sem área',
]);

function forbiddenTerms(facts: DailyNoteFacts): string[] {
  const titles = facts.goalsToday.map((goal) => goal.title);
  const labels = facts.areas
    .map((area) => area.name)
    .filter((name) => !ORDINARY_AREAS.has(name.trim().toLowerCase()));
  return [...titles, ...labels];
}
