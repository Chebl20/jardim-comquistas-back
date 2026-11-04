import { DateTime } from 'luxon';
import { UserGoalService } from '../goals/user-goal.service';
import { resolveDailyStatusForDate } from '../shared/schedule-occurrence.util';

export interface DailyNoteGoalFact {
  title: string;
  area: string;
  harvested: boolean;
}

export interface DailyNoteAreaFact {
  name: string;
  activeGoals: number;
}

export interface RecentDailyNote {
  date: string;
  reflection: string;
  care: string | null;
}

export interface DailyNoteFacts {
  name: string;
  civilDate: string;
  weekday: string;
  goalsToday: DailyNoteGoalFact[];
  areas: DailyNoteAreaFact[];
  recentNotes: RecentDailyNote[];
}

function isRetiredPontual(goal: { goalKind?: string; completed?: boolean }): boolean {
  return String(goal.goalKind || '').toUpperCase() === 'PONTUAL' && goal.completed === true;
}

export async function buildDailyNoteFacts(
  userGoalService: UserGoalService,
  input: {
    userId: string;
    name: string;
    timezone: string;
    civilDate: string;
    recentNotes: RecentDailyNote[];
  },
): Promise<DailyNoteFacts> {
  const zone = DateTime.fromISO(input.civilDate, { zone: input.timezone });
  const day = zone.isValid
    ? zone.startOf('day')
    : DateTime.now().setZone(input.timezone).startOf('day');

  const [allGoals, todayGoals] = await Promise.all([
    userGoalService.getGoalsForUser(input.userId),
    userGoalService.getGoalsForDateForUser(input.userId, day, input.timezone, {
      includeCompleted: true,
    }),
  ]);

  const active = allGoals.filter((goal) => !isRetiredPontual(goal));
  const counts = new Map<string, number>();
  for (const goal of active) {
    const area = String(goal.conquestType || '').trim() || 'Sem área';
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  const goalsToday = todayGoals.map((goal) => ({
    title: goal.title,
    area: String(goal.conquestType || '').trim() || 'Sem área',
    harvested: resolveDailyStatusForDate(goal, day, input.timezone) === 'DONE',
  }));

  const weekday = day.setLocale('pt-BR').toFormat('cccc');
  const name =
    input.name.length > 40 ? `${input.name.slice(0, 40).trim()}…` : input.name;

  return {
    name,
    civilDate: day.toISODate() || input.civilDate,
    weekday,
    goalsToday,
    areas: Array.from(counts, ([name, activeGoals]) => ({ name, activeGoals })),
    recentNotes: input.recentNotes,
  };
}

export function factsAllowCare(facts: DailyNoteFacts): boolean {
  return facts.goalsToday.length > 0 || facts.areas.some((area) => area.activeGoals > 0);
}
