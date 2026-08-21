import type { ScheduleRunHandler } from "eve/schedules";
import { defineSchedule } from "eve/schedules";

import slack from "#channels/slack";
import { env } from "#lib/env";
import { maintenanceRun } from "#lib/schedule";

/**
 * Weekly pass over the agent's own surface: what has drifted out of coherence,
 * and what is missing.
 *
 * @remarks
 * Wednesdays at 08:00 UTC, mid-week and alone in its day. The procedure lives
 * in the `self-review` skill; this file carries the cadence and the delivery,
 * and nothing else.
 */
const run: ScheduleRunHandler = maintenanceRun(
  slack,
  env.DIGEST_SLACK_CHANNEL,
  "Load the self-review skill and run both halves over this agent's own surface: what has drifted out of coherence, and what capability is missing. Report the findings and the proposals separately, and open a draft pull request for the mechanical fixes you can carry through the checks yourself."
);

export default defineSchedule({ cron: "0 8 * * 3", run });
