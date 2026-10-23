import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";

import { env } from "#lib/env";
import { memoryScope, withMemoryAccess } from "#lib/memory";

const TRUST = { slackTeamId: env.SLACK_TEAM_ID };

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
 * Who gets what is the trust model's call (`memoryAccess` in
 * `agent/lib/trust.ts`). The maintainer reads and writes. An unattended
 * review gets no memory at all: the scope resolves to `null`, which disables
 * recall and the save tools for that turn. The review reads a stranger's
 * diff, and a diff that could write into the maintainer's memory would be a
 * diff that could instruct every later turn. Preferences about how to review
 * therefore reach the reviewer through `agent/instructions/` and the skill,
 * not through memory. The app, on its own schedule or on a CI event, reads
 * the same document but is not offered `file__save_memory` or
 * `file__remove_memory`: it reads pull request titles and CI logs strangers
 * wrote, and recall without the write tools is what eve lets a provider
 * express (`withMemoryAccess` in `agent/lib/memory.ts`). Another person the
 * repository trusts, on a mention, gets neither.
 *
 * The document lives in Vercel Blob on a deployment (`eve integration setup
 * file-memory` provisions the store) and in process memory under `eve dev`.
 * A deployment with no store gets no memory rather than no answers. The
 * scope resolves to `null` there too (`agent/lib/memory.ts`).
 */
export default defineMemory({
  description:
    "Durable facts and preferences of the maintainer this agent works for: how they like findings reported, what they consider noise, which repositories matter most, and anything they ask you to remember.",
  provider: withMemoryAccess(fileMemory(), TRUST),
  scope: (ctx) => memoryScope(ctx.session.auth.current, process.env, TRUST),
});
