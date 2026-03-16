/**
 * Migration: converte metas pontuais (scheduleConfig.type === 'once') com at em HH:MM
 * para ISO completo. Usa a data de hoje e o timezone do usuário.
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/migrate-schedule-at-to-iso.ts
 *      ou: npm run migrate:schedule-at
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/prisma/client';

const HH_MM_REGEX = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

async function main() {
  const goals = await prisma.userGoal.findMany({
    where: { scheduleConfig: { not: Prisma.DbNull } },
  });

  const toMigrate: { goal: (typeof goals)[0]; atIso: string }[] = [];

  for (const goal of goals) {
    const sc = goal.scheduleConfig as { type?: string; at?: string } | null;
    if (!sc || sc.type !== 'once' || !sc.at) continue;

    const at = String(sc.at).trim();
    const timeOnly = at.match(HH_MM_REGEX);
    if (!timeOnly) continue; // já está em ISO ou outro formato

    const user = await prisma.user.findUnique({
      where: { id: goal.userId },
      select: { timezone: true },
    });
    const tz = user?.timezone || 'America/Sao_Paulo';
    const hh = parseInt(timeOnly[1], 10);
    const mm = parseInt(timeOnly[2], 10);
    const ss = parseInt(timeOnly[3] || '0', 10);

    const dt = DateTime.now()
      .setZone(tz)
      .set({ hour: hh, minute: mm, second: ss, millisecond: 0 });
    const atIso = dt.toISO()!;

    toMigrate.push({ goal, atIso });
  }

  if (toMigrate.length === 0) {
    console.log('Nenhuma meta com at em HH:MM encontrada.');
    return;
  }

  console.log(`Encontradas ${toMigrate.length} meta(s) para migrar.`);

  for (const { goal, atIso } of toMigrate) {
    const sc = goal.scheduleConfig as { type: string; at: string };
    const updated = { ...sc, at: atIso };
    await prisma.userGoal.update({
      where: { id: goal.id },
      data: { scheduleConfig: updated as object },
    });
    console.log(`  [${goal.id}] "${goal.title}" at: ${sc.at} -> ${atIso}`);
  }

  console.log('Migração concluída.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
