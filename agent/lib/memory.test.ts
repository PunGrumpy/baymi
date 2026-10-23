import type { SessionAuthContext } from "eve/context";
import type { MemoryToolsContext } from "eve/memory";
import { fileMemory, inMemory } from "eve/memory/file";
import { describe, expect, it } from "vitest";

import {
  hasMemoryStore,
  MAINTAINER_SCOPE,
  memoryScope,
  withMemoryAccess,
} from "#lib/memory";

const person = (overrides: Partial<SessionAuthContext> = {}) => ({
  attributes: {},
  authenticator: "slack-webhook",
  principalId: "slack:T0AAAAAAA:U0BBBBBBB",
  principalType: "user",
  ...overrides,
});

/** The principal eve measured for a schedule fire (`docs/notes.md`). */
const APP = person({
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
});

const REVIEWER = person({
  authenticator: "github-webhook",
  principalId: "github:baymiai",
  principalType: "service",
});

const toolsContext = (
  current: SessionAuthContext | null
): MemoryToolsContext => ({
  channel: {},
  memory: {
    scope: { key: "k", namespace: "n", value: MAINTAINER_SCOPE },
    slot: "file",
  },
  messages: [],
  model: null,
  session: { auth: { current, initiator: current }, id: "wrun_1" },
  turn: { id: "turn_1", input: [], sequence: 1 },
});

describe(hasMemoryStore, () => {
  it("always has a store off Vercel, where eve dev keeps it in process", () => {
    expect(hasMemoryStore({})).toBeTruthy();
  });

  it("needs Blob credentials on a deployment", () => {
    expect(hasMemoryStore({ VERCEL: "1" })).toBeFalsy();
    expect(
      hasMemoryStore({ EVE_MEMORY_BLOB_STORE_ID: "store_1", VERCEL: "1" })
    ).toBeTruthy();
    expect(
      hasMemoryStore({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw", VERCEL: "1" })
    ).toBeTruthy();
  });

  it("treats a blank value as absent, the way fileMemory does", () => {
    expect(
      hasMemoryStore({ EVE_MEMORY_BLOB_STORE_ID: "  ", VERCEL: "1" })
    ).toBeFalsy();
  });
});

describe(memoryScope, () => {
  it("gives the maintainer's document to the maintainer and to the app", () => {
    expect(memoryScope(person(), {})).toBe(MAINTAINER_SCOPE);
    expect(memoryScope(APP, {})).toBe(MAINTAINER_SCOPE);
  });

  it("gives the reviewer, a stranger, and no caller nothing", () => {
    expect(memoryScope(REVIEWER, {})).toBeNull();
    expect(
      memoryScope(
        person({ principalId: "eve:evals", principalType: "service" }),
        {}
      )
    ).toBeNull();
    expect(memoryScope(null, {})).toBeNull();
  });

  it("gives a Slack guest nothing once the workspace is pinned", () => {
    expect(memoryScope(person(), {}, { slackTeamId: "T0AAAAAAA" })).toBe(
      MAINTAINER_SCOPE
    );
    expect(memoryScope(person(), {}, { slackTeamId: "T0ZZZZZZZ" })).toBeNull();
  });

  it("gives everyone nothing on a deployment without a store", () => {
    expect(memoryScope(person(), { VERCEL: "1" })).toBeNull();
    expect(memoryScope(APP, { VERCEL: "1" })).toBeNull();
  });
});

describe(withMemoryAccess, () => {
  const inner = fileMemory({ backend: inMemory() });
  const wrapped = withMemoryAccess(inner);

  it("offers the maintainer the tools that change the document", async () => {
    const tools = await wrapped.tools?.(toolsContext(person()));
    expect(tools).toHaveProperty("save_memory");
    expect(tools).toHaveProperty("remove_memory");
  });

  it("offers the app no tool, so it reads the document and cannot change it", async () => {
    await expect(wrapped.tools?.(toolsContext(APP))).resolves.toBeNull();
  });

  it("offers no one else a tool either", async () => {
    await expect(wrapped.tools?.(toolsContext(REVIEWER))).resolves.toBeNull();
    await expect(wrapped.tools?.(toolsContext(null))).resolves.toBeNull();
  });

  it("leaves recall untouched, which is what the app reads through", () => {
    expect(wrapped.recall).toBe(inner.recall);
  });

  it("follows the Slack pin when it offers tools", async () => {
    const pinned = withMemoryAccess(inner, { slackTeamId: "T0ZZZZZZZ" });
    await expect(pinned.tools?.(toolsContext(person()))).resolves.toBeNull();
  });
});
