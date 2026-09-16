/**
 * Places each finding on a line of the pull request's diff.
 *
 * @remarks
 * The model computes line numbers by hand from hunk headers, and one wrong
 * number fails the whole review. So the channel fetches the diff after the
 * reply and settles every finding here: no line goes to the file's first
 * added line, a line outside the diff to the nearest changed line, and a
 * file the diff does not touch into the body.
 */

import { z } from "zod";

import { severityLabel } from "#lib/github/review";
import type {
  AnchoredReview,
  ParsedReview,
  PlacedFinding,
  ReviewFinding,
} from "#lib/github/review";

/** The body of `GET /pulls/{number}/files`, as much of it as is read. */
export const DIFF_FILES = z.array(
  z.object({
    filename: z.string(),
    patch: z.string().optional(),
  })
);

export type DiffFile = z.infer<typeof DIFF_FILES>[number];

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,\d+)? @@/u;

/** The new-side lines GitHub accepts a comment on, by how they got there. */
export interface FileLines {
  readonly added: readonly number[];
  readonly context: readonly number[];
}

export const linesOfPatch = (patch: string): FileLines => {
  const added: number[] = [];
  const context: number[] = [];
  let line = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw)?.groups;
    if (header) {
      line = Number(header.start);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("-") || raw.startsWith("\\")) {
      continue;
    }
    if (raw.startsWith("+")) {
      added.push(line);
    } else {
      context.push(line);
    }
    line += 1;
  }
  return { added, context };
};

export const indexDiff = (
  files: readonly DiffFile[]
): ReadonlyMap<string, FileLines> => {
  const index = new Map<string, FileLines>();
  for (const file of files) {
    if (file.patch !== undefined) {
      index.set(file.filename, linesOfPatch(file.patch));
    }
  }
  return index;
};

/** The candidate closest to `target`; the lower one on a tie. */
const nearest = (
  first: number,
  rest: readonly number[],
  target: number
): number => {
  let best = first;
  for (const candidate of rest) {
    if (Math.abs(candidate - target) < Math.abs(best - target)) {
      best = candidate;
    }
  }
  return best;
};

/**
 * Keeps a line the diff contains. Otherwise prefers the added lines, and
 * falls back to context lines for a file that only lost lines, since a
 * comment cannot sit on the removed side.
 */
export const placeLine = (
  lines: FileLines,
  requested: number | null
): number | null => {
  if (
    requested !== null &&
    (lines.added.includes(requested) || lines.context.includes(requested))
  ) {
    return requested;
  }
  const [first, ...rest] = lines.added.length > 0 ? lines.added : lines.context;
  if (first === undefined) {
    return null;
  }
  return requested === null ? first : nearest(first, rest, requested);
};

/** A finding the diff cannot place, written for the review body. */
export const unplacedFinding = (finding: ReviewFinding): string => {
  const location =
    finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
  const lead = `**${severityLabel(finding.severity)}** · ${finding.title} (\`${location}\`)`;
  return finding.body.length > 0 ? `${lead}\n\n${finding.body}` : lead;
};

/**
 * Settles every finding against the diff and cuts the body to its first
 * line, the count. The review is the inline comments; whatever else the
 * model wrote above the first finding is not posted.
 */
export const anchorReview = (
  review: ParsedReview,
  files: readonly DiffFile[]
): AnchoredReview => {
  const index = indexDiff(files);
  const placed: PlacedFinding[] = [];
  const unplaced: string[] = [];
  for (const finding of review.findings) {
    const lines = index.get(finding.path);
    const line = lines === undefined ? null : placeLine(lines, finding.line);
    if (line === null) {
      unplaced.push(unplacedFinding(finding));
    } else {
      placed.push({ ...finding, line });
    }
  }
  const headline = review.body.split("\n")[0]?.trim() ?? "";
  return {
    body: [headline, ...unplaced].join("\n\n").trim(),
    findings: placed,
  };
};
