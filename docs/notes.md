# Notes

Things that cost time to find out. Each one is why some line of this agent, or of its tooling, looks the way it does, kept here so the code does not have to carry the paragraph.

## eve

**The channel posts the turn's own message, so a comment tool posts a second one.** eve's GitHub channel installs a `message.completed` handler that posts any completed message into the thread the session is anchored to. A turn that answers by calling `github__addIssueComment` or `github__addPullRequestComment` therefore lands twice: the tool's comment, then the reply narrating that it posted the tool's comment. On PR #10 that produced three comments for one summary, and the write tool also raised an approval card the flow did not need, because the summary the session existed to post was gated as if it were an unasked-for write. Every GitHub instruction here now says the reply is the comment; the comment tools are for writing on some _other_ issue or pull request.

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

**A failed sandbox checkout is swallowed, and the turn runs against an empty tree.** `checkoutGitHubRepository` runs `git init` and then a short series of git commands in `/workspace`. When git answers `detected dubious ownership`, eve logs `GitHub checkout failed — swallowed` and continues, so nothing reaches the model or the thread: `read_file`, `glob` and `grep` simply find no files, and the agent reports the repository as empty rather than as unreachable. The error text ends with "Verify the GitHub App installation has access to this repository", which points at permissions when the cause is git refusing a directory another user owns. `agent/sandbox.ts` marks `/workspace` safe in bootstrap.

**The CLI runs on Node, not on Bun, and refuses anything below 24.** Invoking it through `bun run` does not change that, so CI needs `actions/setup-node` alongside `setup-bun` or the eval job dies before reading an eval.

**Vercel reports no cost for these runs, and the Agent Runs API is not a way around it.** `list_agent_run_projects` answers with `costUsd: null` and a per-project rollup; `list_agent_runs` needs access the project's own token does not necessarily carry. Both are downstream of the same fact: the model is reached through `ANTHROPIC_BASE_URL`, not through Vercel's AI Gateway, so nothing on the platform knows the price of a token here. That is why `agent/hooks/evlog.ts` exists and why `MODEL_COST_PER_MTOK` is configuration rather than a lookup.

**`recordShape: 'compact'` writes literally dotted property names, which is what the usage query depends on.** Verified against the project on 2026-08-21 with a `baymi_selftest` event: PostHog stored `eve.caller.principalId` as one property name, not as a nested object and not with the dots rewritten, so the backtick-quoted property paths in `usageQuery` resolve. `distinctIdField` also arrived as the event's `distinct_id`. The same run confirmed the read side end to end: a `Query: Read` personal key against `/api/projects/<id>/query/` answered 200 with the seven columns `parseUsage` reads by name. What is still unproven is the `ai.*` fields themselves, which only exist on a turn that called a model; the self-test made none.

**`@vercel/before-and-after` uploads to a public paste host unless you stop it.** Its `--markdown` flag sends both frames to 0x0.st by default (`--upload-url` overrides it), which is not where a screenshot of an unreleased page belongs. `agent/lib/capture.ts` therefore never passes `--markdown`: the CLI writes files with `--output`, prints one `Saved: <path>` line per frame, and `capture_before_after` reads those two paths out of the sandbox and does the hosting itself on Blob. The filenames are derived from the page title and a timestamp, so those stdout lines are the only contract there is.

**The browser and the extension are separate installs.** `@agent-browser/eve/sandbox` exports `installAgentBrowser`, which puts the binary in the sandbox for anything running under `bash`; the package's default export is the eve extension that adds `browser__*` tools to every prompt. `@vercel/before-and-after` peer-depends on the binary, not on the extension, so captures work with the first alone. Taking both is a per-turn prompt cost for a capability only a capture needs.

**A tool set is priced per turn, and the `maintainer` preset is 20,000 tokens of it.** Measured from `listEveToolDescriptors` over the preset (name + description + input schema): 79 tools, 78,598 characters, roughly 21,800 tokens carried on every turn whatever the turn is about, against 27,473 characters and 7,600 tokens for the 24 in `agent/lib/github/tools.ts`. The heaviest single tool was `listWorkflowRuns` at 3,114 characters, for CI reading that `listCheckRuns` and `getCiFailureContext` already cover. Worth re-measuring the same way before adding a tool back.

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

**PostHog has two hosts and they are not interchangeable.** `POSTHOG_HOST` is the _capture_ endpoint (`us.i.posthog.com`, note the `i`) and takes `POST /batch/` with `{api_key, batch}` authenticated by the `phc_` project key in the body. `POSTHOG_API_HOST` is the _query_ endpoint (`us.posthog.com`) and takes the `phx_` personal key in an `Authorization` header. Posting events at the query host does not fail loudly enough to be obvious. Verified on 2026-08-22: the batch shape `evals/reporters/posthog.ts` sends answered `200 {"status":"Ok"}` against `us.i.posthog.com`.

**Custom chart colours need a SQL insight, not a Trends one.** PostHog resolves a Trends series colour through a data color theme, which is a Teams/Enterprise feature, and `trendsFilter.resultCustomizations[].color` only accepts `preset-1`…`preset-15` — a hex is a 400. A `DataVisualizationNode` over a `HogQLQuery` takes a hex directly at `chartSettings.yAxis[].settings.display.color`, on any plan. The cost is that SQL charts do not zero-fill missing days, so every time series in the dashboards unions a date spine (`arrayJoin(arrayMap(i -> toDate(now()) - i, range(0, 30)))`) under the aggregate. `grid_spacing` on a dashboard is plan-gated the same way and answers "Tile density isn't available".

**`eve add instrumentation/posthog` pins a version that does not typecheck.** The official registry item is the right starting point: eve already calls `registerTelemetry(new OpenTelemetry(...))`, so model calls emit OTel spans whether or not the file exists, and all it adds is a destination. But it pins `@posthog/ai@^7`, whose `PostHogTraceExporter` has no `shutdown` and so does not satisfy `SpanExporter` from a current `@opentelemetry/sdk-trace-base` — `tsc` fails. `@posthog/ai@^8`'s `PostHogSpanProcessor` implements `shutdown` and `forceFlush` and drops straight into `registerOTel`'s `spanProcessors`. The item also writes a fresh `POSTHOG_PROJECT_TOKEN` into `.env.local`, the same `phc_` value as `POSTHOG_API_KEY`; keeping both means keeping one secret in sync under two names.

**Two of `@posthog/ai`'s peers look unused and are not.** Once `PostHogSpanProcessor` replaces the raw exporter, nothing in this repo imports `@opentelemetry/exporter-trace-otlp-http` or `@opentelemetry/sdk-trace-base`, so both read as dead weight. They are optional peer dependencies of `@posthog/ai`, which means the install succeeds without them and `@posthog/ai/otel` then throws `Cannot find module` the first time it is imported. Removing them left `bun run typecheck`, `bun run check` and `bun run test` all green, because no test imports `agent/instrumentation.ts` and types resolve from a different path than the runtime does. An optional peer is a hole in every is-this-used check this repo has; the only thing that catches it is importing the module.

**Model calls outnumber turns about 33 to 1.** Measured 2026-08-22 over 4 turns: 132 model calls, mean 33 per turn, 102 in the worst. Worth knowing before enabling anything that emits one event per generation, and worth re-measuring before assuming a per-event cost.
