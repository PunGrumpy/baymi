import { z } from "zod";

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;

/**
 * The repositories the weekly digest covers, read from a comma-separated
 * `DIGEST_REPOS`.
 *
 * @remarks
 * A list rather than a single value because the shape is the expensive thing
 * to change later: the delivery is not. Each repository gets its own digest in
 * its own Slack thread, so an issue number in a reply means exactly one issue
 * and the thread-reply rules need no notion of which repo `#12` belongs to.
 *
 * Order is preserved and duplicates are dropped, so the same repo listed twice
 * does not post twice.
 *
 * The dedupe keeps the first entry apart from the rest so the result stays a
 * non-empty tuple. `.nonempty()` already guarantees that at runtime, and
 * rebuilding the array from a `Set` used to widen it back to `string[]`,
 * costing every reader the guarantee: `agent/instructions/repositories.ts`
 * names the repositories in the prompt and would otherwise have to branch on
 * an empty list this schema cannot produce.
 */
export const digestRepos = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )
  .pipe(
    z
      .array(z.string().regex(REPO_PATTERN, "expected owner/repo"))
      .nonempty("expected at least one owner/repo")
  )
  .transform(([first, ...rest]): [string, ...string[]] => {
    const seen = new Set([first]);
    const unique: string[] = [];
    for (const repo of rest) {
      if (!seen.has(repo)) {
        seen.add(repo);
        unique.push(repo);
      }
    }
    return [first, ...unique];
  });

/**
 * The task sent into the Slack channel for one repository's digest.
 *
 * @remarks
 * Carries only what the `digest-format` skill cannot know: which repository
 * this run is about, and the rule to fetch it fresh rather than reuse anything
 * from earlier context. With several repos scheduled, each session gets one
 * name and never sees the others.
 */
export const digestPrompt = (repo: string): string =>
  [
    `Fetch all open issues on ${repo} using the GitHub tools and compose this week's issues digest. Your reply is posted to the digest Slack channel; do not send it anywhere yourself.`,
    "Fetch the issues fresh in this run; never reuse counts or lists from earlier context.",
    `Open with one line naming the repository and the week: "Weekly issues digest: ${repo}" and the date. The rest is the digest itself, with no preamble or commentary about the task.`,
    "Load the digest-format skill and follow it for the digest's structure: the grouping, one-line issue summaries, citations, overview, and the closing invitation to reply in the thread.",
  ].join("\n\n");
