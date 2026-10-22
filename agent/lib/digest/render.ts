import type {
  BlockedReason,
  Classified,
  DigestContext,
  HealthyReason,
  NeedsOwnerReason,
} from "#lib/digest/classify";
import { compareText, sorted } from "#lib/digest/sorted";

/**
 * The morning digest as Slack text, in Thai.
 *
 * @remarks
 * The shape is the one `CLAUDE.md` and the `engineering-lead` skill give:
 * what needs the maintainer, as a pull request link with one sentence each;
 * then what is blocked and why; then one line counting the healthy rest, last.
 * No preamble and no sign-off. Links, repository names and check names stay
 * as they are.
 *
 * Every string a stranger can write (a login, a check name, a branch name) is
 * escaped for Slack and fenced as code before it is interpolated, so a
 * pull request cannot put a mention or a link of its own into the digest.
 * Titles are left out for the same reason.
 */

const MAX_NAMES = 3;
const MAX_TEXT = 60;

const RESERVED = /[&<>]/gu;

/** Slack's three reserved characters, which it asks every sender to escape. */
const escapeReserved = (char: string): string => {
  switch (char) {
    case "&": {
      return "&amp;";
    }
    case "<": {
      return "&lt;";
    }
    default: {
      return "&gt;";
    }
  }
};
// oxlint-disable-next-line no-control-regex -- the point is to strip the control characters a name can carry
const UNPRINTABLE = /[\u0000-\u001F\u007F`]/gu;

/** A stranger's string made safe to put inside a Slack code span. */
const inert = (text: string): string => {
  const clean = text.replace(UNPRINTABLE, " ").trim();
  const short =
    clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
  return short.replace(RESERVED, escapeReserved);
};

const code = (text: string): string => `\`${inert(text)}\``;

/** Up to three names, then how many more there were. */
const nameList = (names: readonly string[]): string => {
  const shown = names.slice(0, MAX_NAMES).map(code).join(", ");
  const rest = names.length - MAX_NAMES;
  return rest > 0 ? `${shown} +${rest}` : shown;
};

const link = (entry: Classified): string =>
  `https://github.com/${entry.repository}/pull/${entry.number}`;

const byRepositoryThenNumber = (left: Classified, right: Classified): number =>
  compareText(left.repository, right.repository) || left.number - right.number;

const NEEDS_OWNER_ORDER: Readonly<Record<NeedsOwnerReason["kind"], number>> = {
  "changes-requested": 1,
  conflict: 0,
  question: 1,
  ready: 2,
};

const orderOf = (entry: Classified): number =>
  entry.verdict.bucket === "needs-owner"
    ? NEEDS_OWNER_ORDER[entry.verdict.reason.kind]
    : 0;

const isOwnerLogin = (
  login: string | undefined,
  context: DigestContext
): boolean =>
  login !== undefined &&
  context.owners.some((owner) => owner.toLowerCase() === login.toLowerCase());

const authorName = (entry: Classified): string =>
  entry.author === null ? "ผู้เขียนที่ถูกลบ" : code(entry.author.login);

const needsOwnerSentence = (
  entry: Classified,
  reason: NeedsOwnerReason,
  context: DigestContext
): string => {
  const ownPullRequest = isOwnerLogin(entry.author?.login, context);
  if (reason.kind === "conflict") {
    return ownPullRequest
      ? `มี conflict กับ ${code(entry.baseRef)} ต้อง rebase`
      : `มี conflict กับ ${code(entry.baseRef)} ต้องให้ ${authorName(entry)} แก้`;
  }
  if (reason.kind === "question") {
    return `มีคำถามจาก ${code(reason.from)} ที่ยังไม่มีใครตอบ`;
  }
  if (reason.kind === "changes-requested") {
    return `${code(reason.from)} ขอให้แก้ (changes requested) ที่ยังไม่มีใครตอบ`;
  }
  return ownPullRequest
    ? "เขียวแล้ว รอคุณกด merge"
    : `เขียวแล้ว รอคุณกด merge (โดย ${authorName(entry)})`;
};

/**
 * How many other pull requests fail the same check, said with "at least" when
 * the count is the fewest of several checks.
 */
const siblingCount = (peers: number, checks: number): string =>
  checks > 1 ? `อีกอย่างน้อย ${peers} อัน` : `อีก ${peers} อัน`;

/**
 * One sentence per piece of evidence, and only the evidence that held. A
 * check that fails on other pull requests but passes on the base says exactly
 * that and stops short of "not from the diff": in a stack, the pull requests
 * above a culprit fail because they contain it.
 */
const ciSentence = (
  reason: Extract<BlockedReason, { kind: "ci" }>,
  baseRef: string
): string => {
  const names = nameList(reason.checks);
  const behind = reason.behind ? " และ branch ตามหลัง base" : "";
  switch (reason.failure) {
    case "diff": {
      return `CI ล้ม (${names}) จากโค้ดใน diff เอง ต้องแก้บน branch${behind}`;
    }
    case "base": {
      return `CI ล้ม (${names}) ล้มบน ${code(baseRef)} เหมือนกัน ไม่ใช่จาก diff${behind}`;
    }
    case "siblings": {
      return `CI ล้ม (${names}) ล้มเหมือนกันบน PR อื่นในรีโปนี้${siblingCount(reason.peers, reason.checks.length)} ยังแยกไม่ได้ว่าจาก diff หรือไม่ ต้องเปิด log ดู${behind}`;
    }
    case "flake": {
      return `CI ล้ม (${names}) น่าจะ flake (timeout) ควร rerun ครั้งเดียว`;
    }
    default: {
      return `CI ล้ม (${names}) ยังแยกสาเหตุไม่ได้ ต้องเปิด log ดู${behind}`;
    }
  }
};

const blockedSentence = (entry: Classified, reason: BlockedReason): string => {
  switch (reason.kind) {
    case "ci": {
      return ciSentence(reason, entry.baseRef);
    }
    case "read-failed": {
      return "อ่านสถานะ CI จาก GitHub ไม่สำเร็จ ยังไม่รู้ว่าเขียวหรือแดง ต้องเปิดดูเอง";
    }
    default: {
      return `บอทเขียนความเห็นไว้ ${reason.threads} เธรดที่ยังไม่มีใครดู`;
    }
  }
};

const HEALTHY_LABELS: Readonly<Record<HealthyReason, string>> = {
  release: "release PR",
  stacked: "ซ้อนบน PR อื่น",
  "waiting-author": "รอผู้เขียน",
  "waiting-ci": "รอ CI",
};

/** The order the healthy parts are listed in, fixed so the line is stable. */
const HEALTHY_ORDER: readonly HealthyReason[] = [
  "waiting-ci",
  "waiting-author",
  "stacked",
  "release",
];

const healthyCounts = (entries: readonly Classified[]): string => {
  const parts: string[] = [];
  for (const reason of HEALTHY_ORDER) {
    const count = entries.filter(
      ({ verdict }) => verdict.bucket === "healthy" && verdict.reason === reason
    ).length;
    if (count > 0) {
      parts.push(`${count} ${HEALTHY_LABELS[reason]}`);
    }
  }
  return parts.join(", ");
};

/** What a day with no pull requests at all says. */
export const NO_PULL_REQUESTS = "ไม่มี PR ที่เปิดอยู่ในช่วง 30 วันนี้";

/**
 * Said last when the listing stopped short, whether the search hit its page
 * limit or GitHub aborted the query: what is above is not the whole list.
 */
export const CUT_SHORT =
  "รายการนี้ไม่ครบ: อ่าน PR จาก GitHub ได้ไม่หมด (ชนขีดจำกัดของการค้นหาหรือ query ถูกตัด) อาจมี PR ที่ยังไม่ได้ดู";

/** What the list was read from, beyond the pull requests in it. */
export interface Listing {
  /** True when the listing stopped short, so pull requests may be missing. */
  readonly truncated: boolean;
}

/**
 * Renders the digest for a list of classified pull requests.
 *
 * @remarks
 * Pure: the same list renders the same text. The healthy line is always last
 * and always present once there is anything to say, even when it counts zero,
 * so a reader learns the shape once. The one thing that comes after it is the
 * notice that the list is cut short, and a cut-short list never claims there
 * is nothing: an empty or quiet day says "in what could be read".
 */
export const renderDigest = (
  entries: readonly Classified[],
  context: DigestContext,
  listing?: Listing
): string => {
  const truncated = listing?.truncated === true;
  const notice = truncated ? [CUT_SHORT] : [];
  if (entries.length === 0) {
    return truncated
      ? ["ไม่พบ PR ในส่วนที่อ่านได้", ...notice].join("\n")
      : NO_PULL_REQUESTS;
  }
  const needsOwner = sorted(
    entries.filter(({ verdict }) => verdict.bucket === "needs-owner"),
    (left, right) =>
      orderOf(left) - orderOf(right) || byRepositoryThenNumber(left, right)
  );
  const blocked = sorted(
    entries.filter(({ verdict }) => verdict.bucket === "blocked"),
    byRepositoryThenNumber
  );
  const healthy = entries.filter(({ verdict }) => verdict.bucket === "healthy");

  const lines: string[] = [];
  for (const entry of needsOwner) {
    if (entry.verdict.bucket === "needs-owner") {
      lines.push(
        `${link(entry)} ${needsOwnerSentence(entry, entry.verdict.reason, context)}`
      );
    }
  }
  for (const entry of blocked) {
    if (entry.verdict.bucket === "blocked") {
      lines.push(
        `${link(entry)} ${blockedSentence(entry, entry.verdict.reason)}`
      );
    }
  }

  const breakdown = healthyCounts(healthy);
  const rest = breakdown === "" ? "" : ` (${breakdown})`;
  if (lines.length === 0) {
    const where = truncated ? "ในส่วนที่อ่านได้" : "วันนี้";
    return [
      `ไม่มีอะไรต้องให้คุณดู${where} มี ${healthy.length} อันปกติ${rest}`,
      ...notice,
    ].join("\n");
  }
  lines.push(`อีก ${healthy.length} อันปกติ${rest}`, ...notice);
  return lines.join("\n");
};
