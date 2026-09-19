# What to look for, by kind of change

Every item is a pattern to search for in the diff and the code around it. "Reaches" means there is a path in the code from one to the other. Find that path with `grep` and `read_file` before reporting.

## Input handling

- A request field, header, cookie, query string, or body value reaches a SQL or NoSQL query, a shell command, a file path, a template, an HTML response, a redirect target, a URL that is fetched, a regular expression, or a deserializer. Is it validated or parameterized on that path, and where?
- A value is validated on the client and trusted on the server.
- An allow list became a deny list, or a check was loosened (a regex anchored at one end, a `startsWith` where an exact match was, a `includes` on a host name).
- Numeric or size limits removed: pagination caps, upload sizes, string lengths, array lengths, recursion depth.
- A parser or decoder called on untrusted bytes without a size bound.

## Second-order use and trust boundaries

The section above is first-order: input reaches a sink inside one request. These are the ones that survive a round trip, and the reason a hunk can look safe on its own.

- A value stored safely and used dangerously later: a stored string that becomes a URL that is fetched, a regular expression, a template, a file path, a policy expression, or HTML in a renderer that does not escape.
- Injection through a key, a field name, a header name, or a path segment rather than a value: a field name that becomes a JSON path or a column, a slug that becomes a file path, an id that becomes a cache key.
- The guarantee one component produces set against what the next one assumes: truncation, type coercion, normalization, case folding, or a tenant scope applied on one side and relied on by the other.
- A second write path into a store that the read path trusts: an import, a migration, an admin tool, a queue consumer, a seed script. Validation on the main path binds nothing the other path skips.
- Injection into a secondary system somebody else reads: logs, a search index, a cache, analytics, the body of a notification.

## Authentication and authorization

- A route, handler, resolver, or RPC method added without the middleware or check its siblings have. Compare it with the file's other routes.
- An existing check removed, moved later, made conditional, or wrapped in a try/catch that swallows its failure.
- A record fetched by an id from the request without a check that the caller owns it or may see it.
- A role, scope, or permission compared with a string that the client supplies.
- Session or token handling: tokens that stop expiring, are logged, are put in URLs, or are compared with `==` rather than a constant-time compare; password hashing weakened or replaced with a plain hash.
- Anything that grants, elevates, or invites (invitations, role changes, API key creation) without confirming who asked.

## Feature abuse and data leakage

Bugs in the design rather than in the code: a feature working exactly as written, used for something it was not meant for. Read a new endpoint for what it lets a low-privilege caller reach, not only for whether it has a check.

- Export, backup, snapshot, or report generation that gathers more than the caller can read directly: other people's records, deleted or draft content, revision history, fields the interface hides.
- Import or restore that writes without the permission model the normal path enforces: overwriting existing records, creating rows that skip validation, writing into a collection the caller cannot write to.
- Search, filter, sort, or count as an oracle: a query that reveals whether a record exists, a filter on a field the caller may not read, an ordering that discloses a hidden value.
- Enumeration through a difference the caller can observe: "not found" against "no access", a status code, a response size, a timing gap, or the behaviour of a reset, invite, or registration flow.
- A preview, draft, or share token that unlocks more than the one item, and unpublished content reachable through a listing endpoint, a feed, a sitemap, or a CDN that caches it public.
- A URL the caller supplies and the server fetches: a webhook, a callback, a notification target, an avatar import, a link preview. Is it checked against internal addresses, and is it checked again after a redirect?

## Secrets and configuration

- A credential, token, key, connection string, or private key in the diff, including in tests, fixtures, examples, or a committed `.env`. Look at the value, not only the name.
- A secret written to a log, an error message, a response body, or telemetry.
- A `.gitignore` entry removed, or a previously ignored file added.
- Debug, verbose, or insecure flags enabled: `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False`, `debug: true`, `allowInsecure`, disabled certificate checks.
- CORS opened (`*`, reflected origin with credentials), a CSP removed or loosened, cookies losing `HttpOnly`, `Secure`, or `SameSite`.
- Default credentials, default admin accounts, or a first-run setup that stays open.

## Dependencies

- A new dependency: what it is, who publishes it, whether the name is one letter from a popular package, whether it declares install scripts, and whether the code actually uses it.
- A version pin loosened, a lockfile removed, a registry or resolved URL changed to somewhere other than the default registry, a git or tarball dependency added.
- A dependency swapped for a fork.
- A bump across a major version of a security-relevant package (auth, crypto, parsers, ORMs) with no corresponding code change.

## CI, workflows, and build

- `pull_request_target`, `workflow_run`, or `issue_comment` triggers that check out or run code from the pull request head.
- Untrusted input (`github.event.*` titles, bodies, branch names, comments) interpolated into a `run:` step.
- A third-party action referenced by tag or branch rather than a commit SHA; a new action from an unfamiliar publisher.
- Permissions widened (`permissions: write-all`, `contents: write` where read was enough) or secrets passed to a step that does not need them.
- A build or release script that fetches and executes a remote resource (`curl | sh`, a script downloaded at build time).
- Artifact or cache poisoning: caches keyed on attacker-controlled values, artifacts from untrusted runs consumed by trusted ones.

## Infrastructure and containers

- A container running as root, a broad `COPY . .` that copies secrets into the image, a base image by floating tag.
- Ports, storage buckets, databases, or functions made public; IAM or policy documents widened; wildcard resources or actions.
- Encryption at rest or in transit turned off; TLS versions lowered; backups made public.

## Data handling and privacy

- Personal data written to logs, analytics, error trackers, or third parties that did not receive it before.
- Retention removed or extended without a reason in the change.
- Data crossing a tenant boundary: a query that lost its tenant filter, a cache keyed without the tenant.

## Cryptography

- A homegrown algorithm or protocol; MD5 or SHA-1 for anything that needs collision resistance; ECB mode; a static IV or nonce; a key derived from a password without a proper KDF.
- Randomness from `Math.random` or an unseeded generator for anything security-relevant: tokens, ids that must be unguessable, nonces.
- A signature verified after its payload is used, or with the algorithm taken from the payload.

## LLM and agent features

- Content from users, documents, web pages, or tool results concatenated into a prompt that also contains instructions, with the model then allowed to take actions.
- A tool that can read secrets, write files, send messages, or spend money, reachable by a model that reads untrusted content, without an approval step.
- Model output used as code, as a shell command, as a query, or as HTML without validation.
- A tool argument taken from the model when the session already knows the answer: the record, the recipient, or the repository decided by text the model read rather than by the context it was dispatched with.
- Anything the model writes reaching a store a later session reads back as instruction: memory, a summary, a cached note, a document index. Who can write into it, and is writing off on the turns that read untrusted content?
- A tool description, a parameter schema, or the list an MCP server advertises treated as trusted text. It is in the prompt, and whoever runs the server writes it.
- Identity lost between the model and the tool: one connection or token shared across callers, an approval bound to the request rather than to the person, a principal that widens when one tool calls another.
- Retrieved context a stranger can plant: an issue body, a commit message, a document, a fetched page. The retrieval step is the injection point, not the prompt template.

## Denial of service and resource exhaustion

- A new endpoint with unbounded work per request: an expensive query, an image transform, a fan-out, a regular expression with nested quantifiers on untrusted input.
- Missing timeouts on outbound requests; unbounded retries; queues without a cap.

## Business logic

No scanner finds these. For a workflow the change touches, ask what an authenticated caller gets by using it wrongly rather than by breaking it.

- A step skipped, repeated, or taken out of order: a flow resumed from a later state, a completed flow replayed, a terminal state left.
- A multi-step operation with no rollback: step two fails and step one stands. Charges, grants, invitations, and deletions are where that hurts.
- A number the caller controls and the code does not bound: a negative amount, zero, an overflow, precision lost in a float, a string coerced to a number, a quantity that reverses a sign.
- A limit, quota, or expiry evaluated against a value the caller sets, or against a clock the caller can move.
- The posture when something is missing: a config value absent, a feature flag off, a dependency down, a migration half applied. Does the path fail closed, or continue without the check?
- A value read back from storage, config, or another service and trusted because something validated it once, when another path can write it.

## Timing and state

- A check-then-act on a shared resource without a lock or a transaction: balance checks, quota checks, unique-name checks.
- A temporary file with a predictable name; a file created before its permissions are set.

## The obvious things

Cheap to check, and easy to leave to somebody else. Go through these on any change large enough that nobody read all of it.

- A TODO, FIXME, HACK, or XXX that names a security control: `TODO: add auth`, `FIXME: validate this`, a check commented out with a note promising to put it back.
- Debug, test, or maintenance behaviour reachable in production: a mode switched on by an environment variable, a query parameter, or a header; a seed or example account that still authenticates.
- An endpoint added with no gate because of what it is called: `/health`, `/metrics`, `/status`, `/debug`, `/admin`, `/env`, `/config`. What does it return, and who can reach it?
- A file that should never have been committed: `.env`, `.env.local`, `credentials.json`, `*.pem`, `*.key`, a database dump, a `.tfstate`.
- A dependency change with no lockfile change, or a lockfile change with no manifest change.
