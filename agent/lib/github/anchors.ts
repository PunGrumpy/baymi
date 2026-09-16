/**
 * Places each finding on a line GitHub will accept, using the pull
 * request's own diff.
 *
 * @remarks
 * The model reads a unified diff, so a line number it writes is a
 * hand-computed offset from a hunk header, and one wrong number sends the
 * whole review back to the timeline as a comment. The channel fetches the
 * diff again after the reply and settles the anchors here: a finding with
 * no line lands on the file's first added line, a finding with a line the
 * diff does not contain moves to the nearest line it does, and a finding on
 * a file the diff does not touch cannot be placed at all and goes back
 * into the body.
 */

import type {
  AnchoredReview,
  ParsedReview,
  PlacedFinding,
  ReviewFinding,
} from "#lib/github/review";

/** One changed file, in the shape `GET /pulls/{number}/files` returns. */
export interface DiffFile {
  readonly filename: string;
  readonly patch?: string | null;
}

/** `@@ -12,4 +15,6 @@`; only the new-side start matters here. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,\d+)? @@/u;

/** The lines of one file GitHub accepts on the `RIGHT` side. */
export interface FileLines {
  /** Lines the change added, in order. */
  readonly added: readonly number[];
  /** Unchanged lines inside a hunk, in order. */
  readonly context: readonly number[];
}

/**
 * Reads the new-side line numbers out of a unified patch. Removed lines
 * have no new-side number, so they never appear.
 */
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
    if (!inHunk) {
      continue;
    }
    if (raw.startsWith("+")) {
      added.push(line);
      line += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      // A removed line, or "\ No newline at end of file".
    } else {
      context.push(line);
      line += 1;
    }
  }
  return { added, context };
};

/** The placeable lines of every file in the diff, keyed by path. */
export const indexDiff = (
  files: readonly DiffFile[]
): ReadonlyMap<string, FileLines> => {
  const index = new Map<string, FileLines>();
  for (const file of files) {
    if (file.patch) {
      index.set(file.filename, linesOfPatch(file.patch));
    }
  }
  return index;
};

/** The line closest to `target`, the lower one on a tie. */
const nearest = (
  candidates: readonly number[],
  target: number
): number | null => {
  let best: number | null = null;
  for (const candidate of candidates) {
    if (
      best === null ||
      Math.abs(candidate - target) < Math.abs(best - target)
    ) {
      best = candidate;
    }
  }
  return best;
};

/**
 * The line a finding should sit on, or `null` when the file gives it
 * nowhere to sit.
 *
 * @remarks
 * A line the diff contains is kept as written. Otherwise the added lines
 * are preferred, because a finding is about what the change did; a file
 * with only removals falls back to its context lines, since GitHub cannot
 * anchor on the removed side of a review comment.
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
  const preferred = lines.added.length > 0 ? lines.added : lines.context;
  if (preferred.length === 0) {
    return null;
  }
  return requested === null
    ? (preferred[0] ?? null)
    : nearest(preferred, requested);
};

/**
 * A finding the diff cannot place, rendered for the review body: the same
 * severity lead as an inline comment, and the file it belongs to, so the
 * reader is not left with a heading alone.
 */
export const unplacedFinding = (finding: ReviewFinding): string => {
  const severity = `${finding.severity[0]?.toUpperCase() ?? ""}${finding.severity.slice(1)}`;
  const location =
    finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
  return [`**${severity}** · ${finding.title} (\`${location}\`)`, finding.body]
    .filter((part) => part.length > 0)
    .join("\n\n");
};

/**
 * Settles every finding against the diff. Findings that cannot be placed
 * are appended to the body in order, after whatever the model wrote there.
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
  return {
    body: [review.body, ...unplaced].join("\n\n").trim(),
    findings: placed,
  };
};
