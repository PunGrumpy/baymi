import { describe, expect, it, vi } from "vitest";

import type { DisposableSandbox } from "#lib/sandbox";
import { releaseSandbox } from "#lib/sandbox";

const holding = (sandbox: DisposableSandbox) => () => Promise.resolve(sandbox);

describe(releaseSandbox, () => {
  it("deletes the sandbox the turn holds", async () => {
    const remove = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const result = await releaseSandbox(holding({ delete: remove }));
    expect(result).toStrictEqual({ ok: true });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("answers rather than throws when the delete is refused", async () => {
    const result = await releaseSandbox(
      holding({
        delete: () => Promise.reject(new Error("409 sandbox is busy")),
      })
    );
    expect(result).toStrictEqual({
      error: "sandbox not released: Error: 409 sandbox is busy",
      ok: false,
    });
  });

  it("answers rather than throws when there is no sandbox to resolve", async () => {
    const result = await releaseSandbox(() =>
      Promise.reject(new Error("no sandbox in this context"))
    );
    expect(result.ok).toBeFalsy();
  });
});
