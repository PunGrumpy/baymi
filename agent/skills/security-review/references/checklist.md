# What to look for, by kind of change

Every item is a pattern to search for in the diff and the code around it. "Reaches" means there is a path in the code from one to the other. Find that path with `grep` and `read_file` before reporting.

## Input handling

- A request field, header, cookie, query string, or body value reaches a SQL or NoSQL query, a shell command, a file path, a template, an HTML response, a redirect target, a URL that is fetched, a regular expression, or a deserializer. Is it validated or parameterized on that path, and where?
- A value is validated on the client and trusted on the server.
- An allow list became a deny list, or a check was loosened (a regex anchored at one end, a `startsWith` where an exact match was, a `includes` on a host name).
- Numeric or size limits removed: pagination caps, upload sizes, string lengths, array lengths, recursion depth.
- A parser or decoder called on untrusted bytes without a size bound.

## Authentication and authorization

- A route, handler, resolver, or RPC method added without the middleware or check its siblings have. Compare it with the file's other routes.
- An existing check removed, moved later, made conditional, or wrapped in a try/catch that swallows its failure.
- A record fetched by an id from the request without a check that the caller owns it or may see it.
- A role, scope, or permission compared with a string that the client supplies.
- Session or token handling: tokens that stop expiring, are logged, are put in URLs, or are compared with `==` rather than a constant-time compare; password hashing weakened or replaced with a plain hash.
- Anything that grants, elevates, or invites (invitations, role changes, API key creation) without confirming who asked.

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

## Denial of service and resource exhaustion

- A new endpoint with unbounded work per request: an expensive query, an image transform, a fan-out, a regular expression with nested quantifiers on untrusted input.
- Missing timeouts on outbound requests; unbounded retries; queues without a cap.

## Timing and state

- A check-then-act on a shared resource without a lock or a transaction: balance checks, quota checks, unique-name checks.
- A temporary file with a predictable name; a file created before its permissions are set.
