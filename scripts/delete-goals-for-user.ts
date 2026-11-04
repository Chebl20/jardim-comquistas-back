/**
 * Remove metas por título para um usuário (email), incluindo árvore e growth events.
 * Limpa referências em ConversationSession.payload.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/delete-goals-for-user.ts
 *   npx ts-node -r tsconfig-paths/register scripts/delete-goals-for-user.ts --dry-run
 */

import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/prisma/client';

const USER_EMAIL = 'gabrielmenezes1905@gmail.com';
const GOAL_TITLES = ['Beber mais água', 'Beber suco'];

type JsonObj = Record<string, unknown>;

function stripRemovedGoalIds(payload: unknown, removedIds: Set<string>): JsonObj | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const p = { ...(payload as JsonObj) };
  let changed = false;

  if (typeof p.pendingGoalId === 'string' && removedIds.has(p.pendingGoalId)) {
    delete p.pendingGoalId;
    delete p.pendingGoalTitle;
    delete p.pendingGoalDescription;
    changed = true;
  }
  if (Array.isArray(p.pendingGoalIds)) {
    const next = p.pendingGoalIds.filter(
      (id) => typeof id !== 'string' || !removedIds.has(id),
    );
    if (next.length !== p.pendingGoalIds.length) {
      p.pendingGoalIds = next;
      changed = true;
    }
  }
  if (p.reminderContext && typeof p.reminderContext === 'object') {
    const rc = { ...(p.reminderContext as JsonObj) };
    let rcChanged = false;
    if (
      typeof rc.pendingGoalId === 'string' &&
      removedIds.has(rc.pendingGoalId)
    ) {
      delete rc.pendingGoalId;
      delete rc.pendingGoalTitle;
      delete rc.pendingGoalDescription;
      rcChanged = true;
    }
    if (Array.isArray(rc.pendingGoalIds)) {
      const next = rc.pendingGoalIds.filter(
        (id) => typeof id !== 'string' || !removedIds.has(id),
      );
      if (next.length !== rc.pendingGoalIds.length) {
        rc.pendingGoalIds = next;
        rcChanged = true;
      }
    }
    if (rcChanged) {
      p.reminderContext = rc;
      changed = true;
    }
  }
  return changed ? p : null;
}

async function audit(userId: string, goals: { id: string; title: string; plantedTreeId: string | null }[]) {
  console.log('\n=== AUDITORIA ===');
  for (const g of goals) {
    const [schedule, reminder, exceptions, growthEvents] = await Promise.all([
      prisma.goalSchedule.count({ where: { goalId: g.id } }),
      prisma.goalReminder.count({ where: { goalId: g.id } }),
      prisma.goalOccurrenceException.count({ where: { goalId: g.id } }),
      g.plantedTreeId
        ? prisma.growthEvent.count({ where: { plantedTreeId: g.plantedTreeId } })
        : Promise.resolve(0),
    ]);
    const tree = g.plantedTreeId
      ? await prisma.plantedTree.findUnique({ where: { id: g.plantedTreeId } })
      : null;
    console.log({
      goalId: g.id,
      title: g.title,
      plantedTreeId: g.plantedTreeId,
      schedule,
      reminder,
      exceptions,
      growthEvents,
      treeFound: !!tree,
    });
  }
  const session = await prisma.conversationSession.findUnique({
    where: { userId },
  });
  if (session) {
    console.log('ConversationSession:', {
      id: session.id,
      state: session.state,
      payload: session.payload,
    });
  } else {
    console.log('ConversationSession: (none)');
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
  });
  if (!user) {
    console.error(`Usuário não encontrado: ${USER_EMAIL}`);
    process.exit(1);
  }
  console.log('User:', { id: user.id, email: user.email, name: user.name });

  const goals = await prisma.goal.findMany({
    where: { userId: user.id, title: { in: GOAL_TITLES } },
    select: { id: true, title: true, plantedTreeId: true },
  });

  const sucoLike = await prisma.goal.findMany({
    where: { userId: user.id, title: { contains: 'suco', mode: 'insensitive' } },
    select: { id: true, title: true },
  });
  if (sucoLike.length && !goals.some((g) => g.title === 'Beber suco')) {
    console.log('Aviso: metas com "suco" no título (não exato "Beber suco"):', sucoLike);
  }

  if (goals.length === 0) {
    console.log('Nenhuma meta alvo encontrada.');
    await audit(user.id, []);
    return;
  }

  console.log('Metas a remover:', goals);
  await audit(user.id, goals);

  if (dryRun) {
    console.log('\n--dry-run: nenhuma alteração feita.');
    return;
  }

  const removedIds = new Set(goals.map((g) => g.id));

  await prisma.$transaction(async (tx) => {
    for (const g of goals) {
      const owned = await tx.goal.findFirst({
        where: { id: g.id, userId: user.id },
      });
      if (!owned) continue;
      const pid = owned.plantedTreeId;
      await tx.goal.deleteMany({ where: { id: g.id, userId: user.id } });
      if (pid) {
        await tx.growthEvent.deleteMany({ where: { plantedTreeId: pid } });
        await tx.plantedTree.delete({ where: { id: pid } });
      }
    }
  });

  console.log('\n=== Metas e árvores removidas ===');

  const session = await prisma.conversationSession.findUnique({
    where: { userId: user.id },
  });
  if (session?.payload) {
    const nextPayload = stripRemovedGoalIds(session.payload, removedIds);
    if (nextPayload) {
      await prisma.conversationSession.update({
        where: { userId: user.id },
        data: { payload: nextPayload as Prisma.InputJsonValue },
      });
      console.log('ConversationSession payload atualizado.');
    }
  }

  console.log('\n=== VERIFICAÇÃO ===');
  const remaining = await prisma.goal.findMany({
    where: { userId: user.id, title: { in: GOAL_TITLES } },
  });
  console.log('Metas alvo restantes:', remaining.length);

  for (const g of goals) {
    const [sched, rem, exc] = await Promise.all([
      prisma.goalSchedule.count({ where: { goalId: g.id } }),
      prisma.goalReminder.count({ where: { goalId: g.id } }),
      prisma.goalOccurrenceException.count({ where: { goalId: g.id } }),
    ]);
    if (g.plantedTreeId) {
      const tree = await prisma.plantedTree.findUnique({
        where: { id: g.plantedTreeId },
      });
      const ev = await prisma.growthEvent.count({
        where: { plantedTreeId: g.plantedTreeId },
      });
      console.log(`Pós-delete ${g.title}: schedule=${sched} reminder=${rem} exceptions=${exc} tree=${tree ? 'EXISTS' : 'ok'} growthEvents=${ev}`);
    } else {
      console.log(`Pós-delete ${g.title}: schedule=${sched} reminder=${rem} exceptions=${exc}`);
    }
  }

  const sessionAfter = await prisma.conversationSession.findUnique({
    where: { userId: user.id },
  });
  if (sessionAfter?.payload) {
    const pl = sessionAfter.payload as JsonObj;
    const refs = [
      pl.pendingGoalId,
      ...(Array.isArray(pl.pendingGoalIds) ? pl.pendingGoalIds : []),
    ].filter((id) => typeof id === 'string' && removedIds.has(id));
    console.log('Session ainda referencia ids removidos:', refs.length ? refs : 'nenhuma');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
