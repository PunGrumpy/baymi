import type { ScheduleRunHandler } from "eve/schedules";
import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack";
import { env } from "#lib/env";
import { maintenanceRun } from "#lib/schedule";

/**
 * Weekly pass over the repository itself: its documentation against the code
 * it describes, its own conventions, and the issues nobody came back to.
 *
 * @remarks
 * Fridays at 08:00 UTC, closing the week the digest opened. The procedure
 * lives in the `repo-health-sweep` skill; this file carries the cadence and
 * the delivery, and nothing else.
 */
const run: ScheduleRunHandler = maintenanceRun(
  slack,
  env.DIGEST_SLACK_CHANNEL,
  "Load the repo-health-sweep skill and run the sweep over each repository in the digest list. Verify every claim against the code on the default branch, report the findings with the file and the line of prose each one contradicts, and open a draft pull request for the mechanical fixes you can carry through the checks yourself."
);

export default defineSchedule({ cron: "0 8 * * 5", run });
