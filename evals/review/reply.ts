import { parseReview } from "#lib/github/review";
import type { Severity } from "#lib/github/review";

/**
 * Whether a reply would become an inline comment on `path`.
 *
 * @remarks
 * It asks the function the GitHub channel asks, `parseReview`, rather than a
 * pattern of its own. A reply the parser returns `null` for is posted as an
 * ordinary comment, and one it parses with no findings has no inline
 * comments, so a model that answers in bullets instead of the
 * `### High · title` and `File:` block fails this even though a person
 * reading it sees a review. A regular expression in the eval can drift from
 * the parser; this cannot.
 *
 * A finding with `File: path` and no line counts. The skill allows it, and
 * the channel places it on the file's first added line (`anchorReview`).
 */
export const hasParsedFinding = (
  message: string | undefined,
  path: string,
  severities: readonly Severity[]
): boolean =>
  parseReview(message ?? "")?.findings.some(
    (finding) => finding.path === path && severities.includes(finding.severity)
  ) ?? false;
