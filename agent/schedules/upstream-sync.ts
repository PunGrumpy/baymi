import type { ScheduleRunHandler } from "eve/schedules";
import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack";
import { env } from "#lib/env";
import { maintenanceRun } from "#lib/schedule";

/**
 * Weekly check of the frameworks this agent runs on.
 *
 * @remarks
 * Mondays at 07:00 UTC, two hours ahead of the digest so the two land in their
 * own threads at their own times. On Vercel's Hobby plan a cron fires
 * somewhere inside its hour, so nothing here depends on the minute.
 *
 * The procedure lives in the `upstream-sync` skill; this file carries the
 * cadence and the delivery, and nothing else.
 */
const run: ScheduleRunHandler = maintenanceRun(
  slack,
  env.DIGEST_SLACK_CHANNEL,
  "Load the upstream-sync skill and run this week's check over the packages this agent runs on. Report what moved, what is worth taking, and open a draft pull request for anything you can carry through the checks yourself."
);

export default defineSchedule({ cron: "0 7 * * 1", run });
