import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";

import { hasMemoryStore } from "#lib/memory";
import { isUnattended } from "#lib/trust";

/**
 * What the agent remembers between conversations: one document, for one
 * person.
 *
 * @remarks
 * This is a solo maintainer's companion, so the memory is theirs wherever
 * they speak from. The scope is a constant rather than `byPrincipal`: the
 * same person is `github:<id>` on a pull request and `slack:<team>:<id>` in
 * a DM, and a preference stated in one place should hold in the other.
 * Every principal that reaches an attended turn was admitted by a trust
 * gate first (`agent/lib/trust.ts`), which is what makes one shared scope
 * safe.
 *
 * An unattended review gets no memory at all: the scope resolves to `null`,
 * which disables recall and the save tools for that turn. The review reads a
 * stranger's diff, and a diff that could write into the maintainer's memory
 * would be a diff that could instruct every later turn. Preferences about
 * how to review therefore reach the reviewer through `agent/instructions/`
 * and the skill, not through memory.
 *
 * The document lives in Vercel Blob on a deployment (`eve integration setup
 * file-memory` provisions the store) and in process memory under `eve dev`.
 * A deployment with no store gets no memory rather than no answers: the
 * scope resolves to `null` there too (`agent/lib/memory.ts`).
 */
export default defineMemory({
  description:
    "Durable facts and preferences of the maintainer this agent works for: how they like findings reported, what they consider noise, which repositories matter most, and anything they ask you to remember.",
  provider: fileMemory(),
  scope: (ctx) =>
    isUnattended(ctx.session.auth.current) || !hasMemoryStore(process.env)
      ? null
      : "maintainer",
});
