import { DateTime } from 'luxon';
import { prisma } from '../../prisma/client';

/**
 * Prisma adapter for cancelled GoalOccurrenceException rows on a civil day.
 * Read-only: skip-hoje grava SKIPPED + silenceUntil, não escreve exception.
 * Occurrence rules stay in schedule-occurrence.util.ts (no I/O).
 */
export async function getCancelledExceptionsForDate(
  goalIds: string[],
  targetDate: DateTime,
  timezone: string,
): Promise<Set<string>> {
  if (goalIds.length === 0) return new Set();

  const targetStart = targetDate.setZone(timezone).startOf('day');
  const targetEnd = targetDate.setZone(timezone).endOf('day');

  const exceptions = await prisma.goalOccurrenceException.findMany({
    where: {
      goalId: { in: goalIds },
      isCancelled: true,
      originalOccurrenceStart: {
        gte: targetStart.toJSDate(),
        lte: targetEnd.toJSDate(),
      },
    },
    select: { goalId: true },
  });

  return new Set(exceptions.map((e) => e.goalId));
}
