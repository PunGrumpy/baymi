import type { FailureReason } from "#lib/github/ci/classify";
import type { SpeakReason } from "#lib/github/ci/decide";
import type { PullRequestRef } from "#lib/github/pull-requests";
import type { SlackMessagePayload } from "#lib/slack/notify";

/**
 * The one line Slack gets about a red check, in Thai, pull request link first.
 *
 * @remarks
 * Rendered here, not composed by the model: the words are fixed per outcome,
 * and the only free text is the failing line from a log, which a stranger's
 * code may have printed. That line is escaped the way Slack asks (`&`, `<`,
 * `>`), stripped of backticks so it cannot close its own code span, and cut,
 * so a log line can neither mention a channel nor write a link.
 */

const EVIDENCE_MAX = 140;

/** Slack acts on `&`, `<` and `>` (a mention, a link, an entity), so those three are escaped, `&` first. */
const safe = (text: string): string =>
  text
    .replaceAll("`", "'")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, EVIDENCE_MAX)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export interface CiLineInput {
  readonly attempt: number;
  /** Why the classifier said what it did, which words a caller the diff broke differently. */
  readonly failure?: FailureReason;
  /** The log line, the check's summary, or why the chase stopped; may be missing. */
  readonly evidence: string | null;
  /** The failed job, or the external check's name. */
  readonly job: string;
  readonly pullRequest: PullRequestRef;
  readonly reason: SpeakReason;
}

/** What each reason says before the job, short enough to read on a lock screen. */
const HEADLINE: Readonly<Record<SpeakReason, string>> = {
  "cannot-rerun": "CI ล้มแบบ flake แต่ GitHub ไม่ให้รันใหม่",
  "chase-failed": "CI ล้มจากโค้ดใน PR เอง ไล่แก้อัตโนมัติไม่สำเร็จ รอคุณ",
  "external-check": "เช็กภายนอกล้ม ไม่มี agent รันซ้ำหรืออ่าน log ได้",
  "own-code": "CI ล้มจากโค้ดใน PR เอง",
  "rerun-not-done": "CI ล้มแบบ flake แต่ยังไม่ได้รันใหม่",
  "second-failure": "CI ล้มซ้ำหลังรันใหม่แล้ว ไม่ใช่ flake",
  "stale-base": "CI ล้มนอกไฟล์ที่ PR แตะ และล้มบน base แบบเดียวกัน ไม่ใช่จาก diff",
  unclassified: "CI ล้มแต่จัดประเภทไม่ได้",
};

/**
 * A failure in a file the diff never touched, while the base passes: the
 * checks run on the merge commit, so the diff changed something that file
 * depends on, and a rebase would change nothing.
 */
const BREAKS_CALLER =
  "CI ล้มจากโค้ดใน PR เอง ไฟล์ที่ล้มอยู่นอก diff แต่ใช้สิ่งที่ diff เปลี่ยน (บน base ผ่าน)";

const headlineOf = (input: CiLineInput): string =>
  input.reason === "own-code" && input.failure === "breaks-caller"
    ? BREAKS_CALLER
    : HEADLINE[input.reason];

/** `https://github.com/o/r/pull/1 CI ล้ม…: job "test": \`line\``. */
export const ciLine = (input: CiLineInput): string => {
  const evidence = input.evidence === null ? "" : safe(input.evidence);
  const detail = evidence === "" ? "" : `: \`${evidence}\``;
  return `${input.pullRequest.url} ${headlineOf(input)} (${safe(input.job)})${detail}`;
};

/**
 * The line as a Slack message. One section block and the same text as the
 * fallback, so a client that renders no blocks shows the same words.
 */
export const ciSlackMessage = (input: CiLineInput): SlackMessagePayload => {
  const text = ciLine(input);
  return {
    attachments: [],
    blocks: [{ text: { text, type: "mrkdwn" }, type: "section" }],
    text,
  };
};

/**
 * The line for a chase whose session died before it could say anything: the
 * maintainer would otherwise never learn a red check went unread.
 */
export const chaseFailedMessage = (input: {
  readonly code?: string;
  readonly pullRequest: PullRequestRef;
}): SlackMessagePayload => {
  const code = input.code ? ` (code ${safe(input.code)})` : "";
  const text = `${input.pullRequest.url} ไล่ CI ไม่สำเร็จ session ล้มกลางทาง${code} เช็กผลเองหรือรอ digest`;
  return {
    attachments: [],
    blocks: [{ text: { text, type: "mrkdwn" }, type: "section" }],
    text,
  };
};
