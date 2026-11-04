import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';
import { ConversationAIService } from '../ia/conversation-ai.service';
import { UserGoalService } from '../goals/user-goal.service';
import { resolveUserTimezone } from '../shared/app-timezone';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { DAILY_NOTE_PROMPT } from './prompt';
import {
  buildDailyNoteFacts,
  factsAllowCare,
  type DailyNoteFacts,
} from './daily-note.context';
import { parseDailyNoteText } from './phrases';

const WINDOW_DAYS = 7;
const LOCK_TTL_SEC = 90;
const POLL_ATTEMPTS = 10;
const POLL_MS = 400;

/** Gravação quando o modelo falha ou a resposta é rejeitada — evita LLM a cada GET. */
export const DAILY_NOTE_FALLBACK_REFLECTION =
  'Nem todo dia pede pressa. Alguns pedem só presença.';

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
    private readonly locks: DistributedLockService,
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

    const cached = await this.findNote(userId, civilDate);
    if (cached) return this.toResponse(cached);

    const lockKey = dailyNoteLockKey(userId, civilDate);
    let holdsLock = await this.locks.tryAcquire(lockKey, LOCK_TTL_SEC);
    if (!holdsLock) {
      const polled = await this.pollForNote(userId, civilDate);
      if (polled) return this.toResponse(polled);
      holdsLock = await this.locks.tryAcquire(lockKey, LOCK_TTL_SEC);
      if (!holdsLock) {
        const late = await this.pollForNote(userId, civilDate, 5);
        if (late) return this.toResponse(late);
      }
    }

    try {
      const raced = await this.findNote(userId, civilDate);
      if (raced) return this.toResponse(raced);

      const recentNotes = await this.recentNotes(userId, civilDate, timezone);
      const facts = await buildDailyNoteFacts(this.goals, {
        userId,
        name: user?.name?.trim() || 'você',
        timezone,
        civilDate,
        recentNotes,
      });

      return await this.generateAndPersist(userId, facts, timezone);
    } finally {
      if (holdsLock) {
        await this.locks.release(lockKey);
      }
    }
  }

  private async generateAndPersist(
    userId: string,
    facts: DailyNoteFacts,
    timezone: string,
  ): Promise<DailyNoteResponse> {
    const generated = await this.generate(facts);
    const reflection = generated?.reflection ?? DAILY_NOTE_FALLBACK_REFLECTION;
    const care = generated?.care ?? null;
    if (!generated) {
      this.logger.warn(
        `Recado do dia ${facts.civilDate}: usando fallback persistido`,
      );
    }
    return this.persistNote(userId, facts.civilDate, reflection, care, timezone);
  }

  private async persistNote(
    userId: string,
    civilDate: string,
    reflection: string,
    care: string | null,
    timezone: string,
  ): Promise<DailyNoteResponse> {
    try {
      const saved = await prisma.dailyNote.create({
        data: { userId, civilDate, reflection, care },
      });
      await this.dropOlderThanWindow(userId, civilDate, timezone);
      return this.toResponse(saved);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.findNote(userId, civilDate);
        if (raced) return this.toResponse(raced);
      }
      this.logger.error(`Falha ao gravar o recado de ${civilDate}`, error);
      return { date: civilDate, reflection, care };
    }
  }

  private toResponse(row: {
    civilDate: string;
    reflection: string;
    care: string | null;
  }): DailyNoteResponse {
    return {
      date: row.civilDate,
      reflection: row.reflection,
      care: row.care,
    };
  }

  private findNote(userId: string, civilDate: string) {
    return prisma.dailyNote.findUnique({
      where: { userId_civilDate: { userId, civilDate } },
    });
  }

  private async pollForNote(
    userId: string,
    civilDate: string,
    attempts = POLL_ATTEMPTS,
  ) {
    for (let i = 0; i < attempts; i++) {
      await sleep(POLL_MS);
      const row = await this.findNote(userId, civilDate);
      if (row) return row;
    }
    return null;
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

  private async generate(facts: DailyNoteFacts) {
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

function dailyNoteLockKey(userId: string, civilDate: string): string {
  return `daily-note:${userId}:${civilDate}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const name = facts.name.trim();
  const nameTerm = name.length >= 3 && name.toLowerCase() !== 'você' ? [name] : [];
  return [...nameTerm, ...titles, ...labels];
}
