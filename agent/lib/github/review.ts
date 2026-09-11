import { createHash } from "node:crypto";

/**
 * The review the model writes, turned into the review GitHub renders.
 *
 * @remarks
 * The model's reply is the review, as everywhere else on this channel. It
 * writes one block per finding in a fixed shape (a severity heading and a
 * `File: path:line` line), and the channel's `message.completed` handler
 * turns each block into an inline comment on that line and the rest into
 * the review body. The model never calls a review tool, so nothing here
 * changes the tool count or the approval policies, and a reply that does
 * not parse as a review is posted as an ordinary comment.
 *
 * Every rendered piece ends with a hidden marker naming the head commit
 * and, for a finding, a stable id. A later turn reads the markers back out
 * of the review threads, which is how a second look knows what it already
 * said.
 */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];

/** One finding, anchored to a line on the pull request's head. */
export interface ReviewFinding {
  readonly body: string;
  readonly line: number;
  readonly path: string;
  readonly severity: Severity;
  readonly title: string;
}

/** The parsed reply: the review body and the findings placed on lines. */
export interface ParsedReview {
  readonly body: string;
  readonly findings: readonly ReviewFinding[];
}

/** The first line of every review the model writes. */
const REVIEW_OPENING = /^Security review:/u;

/** `### High · title` (a colon after the severity is accepted too). */
const FINDING_HEADING =
  /^###\s+(?<severity>Critical|High|Medium|Low)\s*(?:·|:)\s*(?<title>.+?)\s*$/u;

/** `File: path/to/file.ts:42`, with or without backticks. */
const FINDING_LOCATION = /^File:\s*`?(?<path>[^\s`]+?):(?<line>\d+)`?\s*$/u;

interface FindingBlock {
  readonly heading: string;
  readonly lines: string[];
  readonly line: number | null;
  readonly path: string | null;
  readonly severity: Severity;
  readonly title: string;
}

const SEVERITY_BY_HEADING = new Map<string, Severity>(
  SEVERITIES.map((severity) => [severity, severity])
);

/** The severity a heading names; the pattern only admits the four words. */
const severityOf = (heading: string): Severity =>
  SEVERITY_BY_HEADING.get(heading.toLowerCase()) ?? "low";

const trimBlock = (lines: readonly string[]): string => lines.join("\n").trim();

/**
 * Splits the model's reply into the review body and its findings.
 *
 * @remarks
 * Returns `null` when the reply is not a review at all, so the caller posts
 * it as it is. A finding block without a usable `File:` line is not a
 * finding GitHub can place, so it is folded back into the body under its
 * own heading rather than dropped: the reader still sees it, only not on a
 * line.
 */
export const parseReview = (message: string): ParsedReview | null => {
  const text = message.trim();
  if (!REVIEW_OPENING.test(text)) {
    return null;
  }
  const bodyLines: string[] = [];
  const blocks: FindingBlock[] = [];
  let current: FindingBlock | null = null;
  for (const line of text.split("\n")) {
    const heading = FINDING_HEADING.exec(line)?.groups;
    if (heading) {
      current = {
        heading: line,
        line: null,
        lines: [],
        path: null,
        severity: severityOf(heading.severity ?? ""),
        title: heading.title ?? "",
      };
      blocks.push(current);
      continue;
    }
    if (current === null) {
      bodyLines.push(line);
      continue;
    }
    const location = FINDING_LOCATION.exec(line)?.groups;
    if (location && current.path === null) {
      const lineNumber = Number(location.line);
      if (lineNumber > 0 && location.path) {
        Object.assign(current, { line: lineNumber, path: location.path });
        continue;
      }
    }
    current.lines.push(line);
  }
  const findings: ReviewFinding[] = [];
  for (const block of blocks) {
    if (block.path !== null && block.line !== null) {
      findings.push({
        body: trimBlock(block.lines),
        line: block.line,
        path: block.path,
        severity: block.severity,
        title: block.title,
      });
    } else {
      bodyLines.push("", block.heading, ...block.lines);
    }
  }
  return { body: trimBlock(bodyLines), findings };
};

const ID_LENGTH = 8;

/** A stable id for a finding, so a second look can match it to the first. */
export const findingId = (
  finding: Pick<ReviewFinding, "line" | "path" | "title">
): string =>
  createHash("sha256")
    .update(`${finding.path}:${finding.line}:${finding.title}`)
    .digest("hex")
    .slice(0, ID_LENGTH);

const shaAttribute = (sha: string | null): string =>
  sha === null ? "" : ` sha=${sha}`;

/** The hidden marker at the end of one inline comment. */
export const findingMarker = (
  finding: ReviewFinding,
  headSha: string | null
): string =>
  `<!-- baymi:finding id=${findingId(finding)} severity=${finding.severity}${shaAttribute(headSha)} -->`;

/** The hidden marker at the end of the review body. */
export const reviewMarker = (
  findingCount: number,
  headSha: string | null
): string =>
  `<!-- baymi:review findings=${findingCount}${shaAttribute(headSha)} -->`;

const capitalize = (severity: Severity): string =>
  `${severity[0]?.toUpperCase() ?? ""}${severity.slice(1)}`;

/** One inline comment, in the shape GitHub's review API takes. */
export interface RenderedComment {
  readonly body: string;
  readonly line: number;
  readonly path: string;
  readonly side: "RIGHT";
}

/** The review, ready for `POST /pulls/{number}/reviews`. */
export interface RenderedReview {
  readonly body: string;
  readonly comments: readonly RenderedComment[];
}

/**
 * Renders the parsed review: a severity lead on each inline comment, and a
 * marker on everything.
 */
export const renderReview = (
  review: ParsedReview,
  headSha: string | null
): RenderedReview => ({
  body: `${review.body}\n\n${reviewMarker(review.findings.length, headSha)}`.trim(),
  comments: review.findings.map((finding) => ({
    body: [
      `**${capitalize(finding.severity)}** · ${finding.title}`,
      finding.body,
      findingMarker(finding, headSha),
    ]
      .filter((part) => part.length > 0)
      .join("\n\n"),
    line: finding.line,
    path: finding.path,
    side: "RIGHT",
  })),
});

/** GitHub's limit on a comment body, with room for the split notice. */
const COMMENT_MAX_LENGTH = 65_000;

/**
 * Splits a reply that is too long for one comment on paragraph boundaries,
 * the way eve's built-in handler does. Nearly every reply is one chunk.
 */
export const splitComment = (
  body: string,
  maxLength: number = COMMENT_MAX_LENGTH
): readonly string[] => {
  if (body.length <= maxLength) {
    return [body];
  }
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of body.split("\n\n")) {
    const candidate = current === "" ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length > maxLength && current !== "") {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
};
