import { DateTime } from 'luxon';
import {
  REMINDER_POLICY_ACTIONS,
  ReminderGoalRecord,
  ReminderPolicyDecision,
  ReminderPolicyInput,
} from '../reminder.types';
import {
  clusterGoalsIntoGroups,
  filterGoalsForToday,
  type ReminderGroup,
} from '../grouping/reminder-group.util';

export type PlannedSend = {
  goal: ReminderGoalRecord;
  decision: ReminderPolicyDecision;
};

export type PlanUserRemindersInput = {
  userGoals: ReminderGoalRecord[];
  now: DateTime;
  timezone: string;
  cancelledGoalIds: Set<string>;
  policyEngine: { evaluate(input: ReminderPolicyInput): ReminderPolicyDecision };
  groupWindowMinutes: number;
  groupFollowUpMinutes: number;
  groupLastChanceMinutes: number;
};

export type PlanUserRemindersResult = {
  toSend: PlannedSend[];
  skipUpdates: PlannedSend[];
  evaluations: { goalId: string; decision: ReminderPolicyDecision }[];
};

export function planUserReminders(
  input: PlanUserRemindersInput,
): PlanUserRemindersResult {
  const {
    userGoals,
    now,
    timezone,
    cancelledGoalIds,
    policyEngine,
    groupWindowMinutes,
    groupFollowUpMinutes,
    groupLastChanceMinutes,
  } = input;

  const todayGoals = filterGoalsForToday(
    userGoals,
    timezone,
    now,
    cancelledGoalIds,
  );
  const groups = clusterGoalsIntoGroups(
    todayGoals,
    timezone,
    groupWindowMinutes,
    groupFollowUpMinutes,
    groupLastChanceMinutes,
  );

  const goalToGroup = new Map<string, ReminderGroup>();
  for (const group of groups) {
    for (const g of group.goals) {
      goalToGroup.set(g.id, group);
    }
  }

  const processedGroupKeys = new Set<string>();
  const toSend: PlannedSend[] = [];
  const skipUpdates: PlannedSend[] = [];
  const evaluations: { goalId: string; decision: ReminderPolicyDecision }[] =
    [];

  for (const goal of userGoals) {
    const group = goalToGroup.get(goal.id);
    const groupKey = group
      ? group.goals
          .map((g) => g.id)
          .sort()
          .join(',')
      : null;

    if (groupKey && processedGroupKeys.has(groupKey)) continue;

    const decision = policyEngine.evaluate({
      goal,
      now,
      timezone,
      group,
      cancelledGoalIds,
    });

    evaluations.push({ goalId: goal.id, decision });

    if (decision.action === REMINDER_POLICY_ACTIONS.WAIT) {
      continue;
    }

    if (decision.action === REMINDER_POLICY_ACTIONS.SKIP_CYCLE) {
      skipUpdates.push({ goal, decision });
      continue;
    }

    if (
      decision.action === REMINDER_POLICY_ACTIONS.SEND_OPERATIONAL ||
      decision.action === REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP ||
      decision.action === REMINDER_POLICY_ACTIONS.SEND_LAST_CHANCE
    ) {
      if (
        group &&
        (decision.action === REMINDER_POLICY_ACTIONS.SEND_FOLLOW_UP ||
          decision.action === REMINDER_POLICY_ACTIONS.SEND_LAST_CHANCE)
      ) {
        const followUpDecision = { ...decision, slotKey: undefined };
        for (const g of group.goals) {
          toSend.push({ goal: g, decision: followUpDecision });
        }
        processedGroupKeys.add(groupKey!);
      } else {
        toSend.push({ goal, decision });
      }
    }
  }

  return { toSend, skipUpdates, evaluations };
}
