# Notes

Things that cost time to find out. Each one is why some line of this agent, or of its tooling, looks the way it does, kept here so the code does not have to carry the paragraph.

## eve

**A failed queue delivery re-runs the turn, and side effects go with it.** A `TypeError: fetch failed` mid-turn produced this pair in the dev log:

```
[world-local] Queue delivery failed at the transport (loop 2), retrying
  runId: wrun_..., error: 'TypeError: fetch failed'
[workflow-sdk] Re-executing inline steps owned by this queue message —
  a previous delivery crashed mid-body and this redelivery is recovering them
```

The digest schedule dispatched two repositories and three digests arrived in Slack: the same run id, two different step ids, the second one composed fresh rather than replayed. Delivery is at-least-once, so any write the agent makes can happen twice when the transport drops mid-turn. That is not specific to the digest. A pull request comment, a Linear issue, a DM: all of them inherit it. Nothing guards against this today; a guard would have to be idempotency at the step level, not a check inside a skill.

**Schedules do not fire on cadence in dev.** Trigger one by hand: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/weekly-digest`.

**A send with no thread never joins a continuation.** `receiveOnSlack` keys the session on a random UUID when `threadTs` is absent, so each `to(slack, ...)` lands in its own thread. The digest relies on this: one thread per repository is what keeps `#12` in a reply unambiguous.

**The CLI runs on Node, not on Bun, and refuses anything below 24.** Invoking it through `bun run` does not change that, so CI needs `actions/setup-node` alongside `setup-bun` or the eval job dies before reading an eval.

## Configuration

**`imports` wildcards in `package.json` are literal substitutions.** `#*` mapped to `./agent/*` does no extension resolution, which is why every specifier used to carry a `.js` suffix that no source file had. Moving the suffix into the map (`"#*": "./agent/*.js"`) puts it in one place and lets call sites read as `#lib/env`.

**`emptyStringAsUndefined: true` makes `VAR=""` unset, not empty.** A required variable with an empty value in `.env` fails discovery with "missing" rather than a validation error, and `.env.example` placeholders written as `""` are therefore not runnable defaults.

**Nothing validates that a schema is wired to the variable it was written for.** Reading a `z.string()` where a list belongs type-checks, passes every unit test that exercises the schema directly, and passes discovery, and then the digest schedule iterates a string one character at a time. `agent/lib/env.test.ts` exists to catch exactly that, which is why it asserts on parsed shapes rather than on the schema in isolation.

## Model access

**The endpoint decides the vendor, not the SDK.** The provider speaks the Anthropic wire protocol while `ANTHROPIC_BASE_URL` points at a compatible gateway, so `ANTHROPIC_API_KEY` is validated as a plain non-empty string: the token is issued by whatever service answers and does not have an `sk-` shape.

**Model ids and tool support are worth checking against the endpoint, not assumed.** A one-token request with a tool definition attached confirms both that the id resolves and that `stop_reason: tool_use` comes back, which is the capability this agent depends on most. A catalogue listing is not the same as an id the endpoint accepts.

## Tooling

**`ultracite fix` rewrites test code, not just its formatting.** Observed: trailing `undefined` arguments dropped (which changes the call and breaks the types), `toBe(false)` rewritten to `toBeFalsy()`, and `describe("name")` rewritten to `describe(name)` when an identifier of that name is in scope, which only type-checks if the identifier is a function. Read a file back after formatting it, and prefer passing an absent value by reading it off an object over writing a bare `undefined`.

## Deployment

**Vercel Deployment Protection answers before the app does.** Every route on a protected preview returns 401 or a redirect to Vercel SSO, including the webhook paths. Providers do not perform that handshake, so GitHub, Slack and Linear cannot reach a protected preview at all: either bypass protection for the deployment or point the webhooks at production.

**The GitHub App's slug is what the code needs, not its display name.** GitHub derives the slug from the name, and the slug is both the handle people mention and the stem of the `[bot]` login the self-comment guard compares against. The name this agent goes by was already registered, hence `baymiai` on GitHub and the line in `agent/instructions.md` telling the model that both names are it.
