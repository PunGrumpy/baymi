import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The GitHub channel's source, read as text, so a refactor cannot route an
 * app turn around the router.
 *
 * @remarks
 * `routeCompletedMessage` (`./route.ts`) is what keeps the app off the reply
 * path, and its own tests only prove it routes correctly when it is called.
 * Nothing in its tests, and nothing in `tsc`, notices if `message.completed`
 * calls `settleReply` directly again, or if another handler starts posting
 * through something that reaches `postReply`. This test does: it finds every
 * top-level function in `agent/channels/github.ts` that reaches `settleReply`
 * or `postReply`, and fails if the channel's configuration names any of them
 * anywhere but the `reply` callback it hands the router.
 *
 * It is a text reading, not a parser (TypeScript 7 ships no compiler API):
 * comments are dropped, a top-level function is a `const` at the start of a
 * line, and a span is found by matching brackets, which holds for this file's
 * code because every bracket in its strings is balanced.
 */

const SOURCE = readFileSync(
  new URL("../../../channels/github.ts", import.meta.url),
  "utf-8"
)
  .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
  .replaceAll(/^\s*\/\/.*$/gmu, "");

const DECLARATION = /^(?:export )?const (?<name>\w+)\s*=/gmu;

/** Each top-level `const`, with the text up to the next one. */
const declarations = (): ReadonlyMap<string, string> => {
  const starts = [...SOURCE.matchAll(DECLARATION)];
  const found = new Map<string, string>();
  for (const [index, match] of starts.entries()) {
    const name = match.groups?.name ?? "";
    const end = starts[index + 1]?.index ?? SOURCE.length;
    found.set(name, SOURCE.slice(match.index, end));
  }
  return found;
};

const mentions = (text: string, name: string): boolean =>
  new RegExp(`\\b${name}\\b`, "u").test(text);

/** The top-level names that reach `sinks`, the sinks included. */
const reaching = (
  all: ReadonlyMap<string, string>,
  sinks: readonly string[]
): ReadonlySet<string> => {
  const found = new Set(sinks);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of all) {
      if (
        !found.has(name) &&
        [...found].some((reached) => mentions(body, reached))
      ) {
        found.add(name);
        grew = true;
      }
    }
  }
  return found;
};

/** Which bracket closes each opening one. */
const CLOSER = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** The index just past the bracket that closes the one at `open`. */
const closing = (text: string, open: number): number => {
  const stack: string[] = [];
  for (let index = open; index < text.length; index += 1) {
    const character = text[index] ?? "";
    const closer = CLOSER.get(character);
    if (closer !== undefined) {
      stack.push(closer);
    } else if (character === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) {
        return index + 1;
      }
    }
  }
  throw new Error(`no bracket closes the one at ${open}`);
};

/** Where a call sits in a text: from the callee's name to past its closing parenthesis. */
interface Span {
  readonly end: number;
  readonly start: number;
}

/** The span of the call to `callee` in `text`. */
const callSpan = (text: string, callee: string): Span => {
  const start = text.indexOf(`${callee}(`);
  if (start === -1) {
    throw new Error(`${callee} is not called`);
  }
  return { end: closing(text, start + callee.length), start };
};

/** A handler's body in the configuration, from its key to its closing brace. */
const handler = (config: string, event: string): string => {
  const start = config.indexOf(`"${event}"(`);
  if (start === -1) {
    throw new Error(`the channel defines no ${event} handler`);
  }
  return config.slice(start, closing(config, config.indexOf("{", start)));
};

/** The `const` that holds the `githubChannel({ ... })` configuration. */
const CONFIG = "pullRequestChannel";

const all = declarations();
const config = all.get(CONFIG) ?? "";
const replyPath = reaching(
  new Map([...all].filter(([name]) => name !== CONFIG)),
  ["settleReply", "postReply"]
);

/** The configuration with the router's `reply` callback cut out. */
const outsideTheRouter = (): string => {
  const route = callSpan(config, "routeCompletedMessage");
  const call = config.slice(route.start, route.end);
  const replyAt = call.indexOf("reply:");
  const arrow = call.indexOf("=>", replyAt);
  const body = call.indexOf("{", arrow);
  const replyEnd = closing(call, body);
  return (
    config.slice(0, route.start) +
    call.slice(0, replyAt) +
    call.slice(replyEnd) +
    config.slice(route.end)
  );
};

describe("the GitHub channel's reply path", () => {
  it("is found: the configuration, and what reaches settleReply and postReply", () => {
    expect(config).toContain("githubChannel(");
    expect([...replyPath]).toStrictEqual(
      expect.arrayContaining(["postReply", "settleReply"])
    );
  });

  it("is reached only through the router's reply callback", () => {
    const leaks = [...replyPath].filter((name) =>
      mentions(outsideTheRouter(), name)
    );
    expect(leaks).toStrictEqual([]);
  });

  it("is routed by the caller in message.completed", () => {
    expect(handler(config, "message.completed")).toContain(
      "routeCompletedMessage("
    );
  });

  it("is the export eve loads, wrapped so the app gets its own session", () => {
    expect(SOURCE).toMatch(
      /^export default withChaseSessions\(pullRequestChannel\);$/mu
    );
  });
});

describe("the channel's other writes to a pull request", () => {
  it("drops the app's question before anything is posted", () => {
    const body = handler(config, "input.requested");
    const drop = body.indexOf(
      'questionRoute(ctx.session.auth.current) === "drop"'
    );
    expect(drop).toBeGreaterThan(-1);
    expect(body.indexOf("return;", drop)).toBeLessThan(
      body.indexOf("postComment(")
    );
  });

  it("marks a failed turn's caller before turn.failed posts anything", () => {
    const body = handler(config, "turn.failed");
    expect(body.indexOf("markFailedTurn(")).toBeGreaterThan(-1);
    expect(body.indexOf("markFailedTurn(")).toBeLessThan(
      body.indexOf("thread.post(")
    );
  });

  it("checks for the app's failed turn before session.failed posts or settles the check", () => {
    const body = handler(config, "session.failed");
    const quiet = body.indexOf('route === "quiet"');
    expect(quiet).toBeGreaterThan(-1);
    expect(quiet).toBeLessThan(body.indexOf("thread.post("));
    expect(quiet).toBeLessThan(body.indexOf("settleCheck("));
  });
});
