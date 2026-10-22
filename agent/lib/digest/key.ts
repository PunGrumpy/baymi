import { createHash } from "node:crypto";

import type { Classified, Verdict } from "#lib/digest/classify";
import { compareText, sorted } from "#lib/digest/sorted";

/**
 * The key one digest is recorded under, so a delivery that arrives twice
 * posts once.
 *
 * @remarks
 * The Bangkok day plus a hash of the classified set: which pull request is in
 * which bucket for which reason. Queue delivery is at-least-once, so a run
 * can start again after the post went out, and the second run computes the
 * same key from the same data. The hash leaves out the check names, the
 * head commits and the order GitHub listed things in, none of which changes
 * what the digest says, so an incidental push does not mint a new key. A
 * fire on the same day whose set really changed does, and posts again.
 */

const HASH_LENGTH = 12;

const reasonOf = (verdict: Verdict): string => {
  if (verdict.bucket === "blocked") {
    const { reason } = verdict;
    return reason.kind === "ci" ? `ci-${reason.failure}` : reason.kind;
  }
  if (verdict.bucket === "needs-owner") {
    return verdict.reason.kind;
  }
  return verdict.reason;
};

const lineOf = (entry: Classified): string =>
  `${entry.repository}#${entry.number} ${entry.verdict.bucket} ${reasonOf(entry.verdict)}`;

export const digestKey = (
  date: string,
  entries: readonly Classified[]
): string => {
  const set = sorted(entries.map(lineOf), compareText).join("\n");
  const hash = createHash("sha256").update(set).digest("hex");
  return `${date}:${hash.slice(0, HASH_LENGTH)}`;
};
