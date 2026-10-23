import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The chase tools' source, read as text, so a tool cannot stop calling the
 * rule that holds it.
 *
 * @remarks
 * `bind.test.ts` proves which target the session's auth admits and
 * `checks.test.ts` proves which record is a rewrite. Nothing in them, and
 * nothing in `tsc`, notices if a tool stops asking: a `prepare_checkout` or
 * `push_fix` that no longer calls `bindingProblem` is the round-1 defect, and
 * a `run_checks` that records a rewrite without ending the chase leaves the
 * push-time verdict comparing only the first and last trees, which would
 * absorb a rewrite made in a middle run. The tools run inside an eve session
 * and call GitHub and the sandbox, so they cannot be executed here without
 * mocking the modules they import; this reads their source instead, as
 * `reply-path.test.ts` reads the channel's.
 *
 * It is a text reading, not a parser: comments are dropped, a block is found
 * by matching brackets, and a call's position is where its name first
 * appears in the tool's `execute`. That holds for these files, whose strings
 * keep their brackets balanced.
 */

const sourceOf = (name: string): string =>
  readFileSync(
    new URL(`../../subagents/chase/tools/${name}.ts`, import.meta.url),
    "utf-8"
  )
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/^\s*\/\/.*$/gmu, "");

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

/** The `execute` method of a tool, from its name to its closing brace. */
const executeOf = (source: string): string => {
  const start = source.indexOf("async execute(");
  if (start === -1) {
    throw new Error("the tool defines no execute");
  }
  const body = source.indexOf("{", closing(source, source.indexOf("(", start)));
  return source.slice(start, closing(source, body));
};

/** The block of the first `if` whose condition matches `condition`, or `null`. */
const ifBlock = (text: string, condition: RegExp): string | null => {
  const match = condition.exec(text);
  if (match === null) {
    return null;
  }
  const open = text.indexOf("{", match.index + match[0].length - 1);
  return text.slice(open, closing(text, open));
};

/** Whether `first` appears in `text` before every one of `later`. */
const comesBefore = (
  text: string,
  first: string,
  later: readonly string[]
): boolean => {
  const at = text.indexOf(first);
  return (
    at !== -1 &&
    later.every((name) => {
      const found = text.indexOf(name);
      return found === -1 || at < found;
    })
  );
};

describe("prepare_checkout", () => {
  const execute = executeOf(sourceOf("prepare_checkout"));

  it("holds the arguments to the session's auth with bindingProblem", () => {
    expect(execute).toMatch(
      /\bbindingProblem\(\s*auth,\s*target,\s*trust\s*\)/u
    );
    expect(execute).toContain("const auth = ctx.session.auth.current;");
  });

  it("ends the chase with the refusal and returns it before GitHub or the sandbox is reached", () => {
    const block = ifBlock(execute, /if \(problem !== null\) \{/u);
    expect(block).not.toBeNull();
    expect(block).toContain("bindingRefusal(");
    expect(block).toContain("endChase(");
    expect(block).toMatch(/\breturn\b/u);
    expect(
      comesBefore(execute, "bindingProblem(", [
        "mintInstallationToken(",
        "listInstalledRepositories(",
        "githubSend(",
        "ctx.getSandbox(",
        "downloadArchive(",
      ])
    ).toBeTruthy();
  });
});

describe("push_fix", () => {
  const execute = executeOf(sourceOf("push_fix"));

  it("holds the checkout in state to the session's auth with bindingProblem", () => {
    expect(execute).toMatch(
      /\bbindingProblem\(\s*ctx\.session\.auth\.current,\s*task,/u
    );
  });

  it("ends the chase with the refusal and frees the sandbox", () => {
    const block = ifBlock(execute, /if \(problem !== null\) \{/u);
    expect(block).not.toBeNull();
    expect(block).toContain("bindingRefusal(");
    expect(block).toContain("endChase(");
    expect(block).toContain("releaseSandbox(");
    expect(block).toMatch(/\breturn\b/u);
  });

  it("holds the checkout before anything is read or pushed", () => {
    expect(
      comesBefore(execute, "bindingProblem(", [
        "ctx.getSandbox(",
        "mintInstallationToken(",
        "deliverFix(",
        "fixVerdict(",
        "groupCommits(",
      ])
    ).toBeTruthy();
  });
});

describe("run_checks", () => {
  const execute = executeOf(sourceOf("run_checks"));

  it("ends the chase, frees the sandbox and returns when a run rewrote files", () => {
    const block = ifBlock(execute, /if \(rewrote\(record\)\) \{/u);
    expect(block).not.toBeNull();
    expect(block).toContain("endChase(");
    expect(block).toContain("releaseSandbox(");
    expect(block).toMatch(/\breturn\b/u);
  });

  it("checks every run, before the next one can be recorded", () => {
    expect(
      comesBefore(execute, "recordRun(", ["rewrote(record)"])
    ).toBeTruthy();
    expect(execute.indexOf("rewrote(record)")).toBeLessThan(
      execute.lastIndexOf("return")
    );
  });
});
