import type { ScheduleRunHandler } from "eve/schedules";
import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack";
import { env } from "#lib/env";
import { maintenanceRun } from "#lib/schedule";

/**
 * Weekly read of what the agent spent, from its own wide events.
 *
 * @remarks
 * Mondays at 10:00 UTC, an hour after the digest, so the week opens with the
 * issues and then with what last week cost. The procedure lives in the
 * `cost-watchdog` skill; this file carries the cadence and the delivery, and
 * nothing else.
 */
const run: ScheduleRunHandler = maintenanceRun(
  slack,
  env.DIGEST_SLACK_CHANNEL,
  "Load the cost-watchdog skill and review the last full week: what the agent ran, what it spent, and what changed against the week before. Say plainly when a number is missing rather than filling the gap."
);

export default defineSchedule({ cron: "0 10 * * 1", run });
