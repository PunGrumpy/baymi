import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The key the GitHub channel files a chase's result under, read from its
 * source.
 *
 * @remarks
 * `ledger.test.ts` proves the record keeps two keys apart. Nothing in it, and
 * nothing in `tsc`, notices if the channel hands the record a different key:
 * `event.turnId` compiles, and it is the first turn of its own session for
 * every chase, so two pull requests' chases would share a key and the second
 * would settle on the first one's `pushed`. A chase's key is the CI turn's
 * (`owner/repo#run<id>@<attempt>`), read from the session's auth, the same
 * key the gate claims and the rerun record uses. This test finds every call
 * the channel makes on the chase-result record and holds its key to that.
 *
 * It is a text reading, like `reply-path.test.ts`: comments are dropped and a
 * call's arguments are what sits between its parentheses, which holds because
 * the keys here contain none.
 */

const SOURCE = readFileSync(
  new URL("../../../channels/github.ts", import.meta.url),
  "utf-8"
)
  .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
  .replaceAll(/^\s*\/\/.*$/gmu, "");

const RECORD = /^const (?<name>\w+) = createChaseResultRecord\(\);$/mu;

const record = SOURCE.match(RECORD)?.groups?.name ?? "";

interface Call {
  readonly key: string;
  readonly method: string;
  /** The source from the start of the line holding the call, back to the previous handler. */
  readonly before: string;
}

const callsOn = (name: string): readonly Call[] =>
  [
    ...SOURCE.matchAll(
      new RegExp(`\\b${name}\\.(?<method>\\w+)\\((?<args>[^)]*)\\)`, "gu")
    ),
  ].map((match) => ({
    before: SOURCE.slice(0, match.index),
    key: (match.groups?.args ?? "").split(",")[0]?.trim() ?? "",
    method: match.groups?.method ?? "",
  }));

describe("the key the channel files a chase's result under", () => {
  it("is found: the record, and the calls that write and read it", () => {
    expect(record).not.toBe("");
    expect(callsOn(record).map((call) => call.method)).toStrictEqual(
      expect.arrayContaining(["note", "result"])
    );
  });

  it("is the CI turn's key, never an event's turn id", () => {
    const keys = callsOn(record).map((call) => call.key);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys).toStrictEqual(keys.map(() => "turn.key"));
  });

  it("reads that turn off the session's auth, in the handler that notes the result", () => {
    const note = callsOn(record).find((call) => call.method === "note");
    expect(note).toBeDefined();
    const lastTurn = [
      ...(note?.before ?? "").matchAll(/\bconst turn = (?<source>[^;]+);/gu),
    ].at(-1)?.groups?.source;
    expect(lastTurn).toBe("readCiTurn(ctx.session.auth.current)");
  });
});
