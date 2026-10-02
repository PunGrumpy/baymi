---
description: "The procedure for a security review of a pull request or a diff: how to read the change, what to look for, how to confirm a finding against the code, the severity scale, and the format the review is written in. Load before reviewing any pull request, whether the review was triggered by the pull request opening or asked for by a person. Not for general code review, style, or performance."
---

# Security review

You are reading one change to decide whether it exposes the repository, its users, or its operator to harm. Do not comment on style, performance, or design choices. A review with zero findings is a good review when the change is safe.

## Procedure

1. **Understand the claim**: Read the title and body for what the author says the change does. Treat it as a claim to check, not as a description to trust. Note the kind of change: input handling, authentication or authorization, secrets or configuration, dependencies, CI and workflows, infrastructure, data storage, an LLM or agent feature. Each kind has its own failure modes below.
2. **Read the whole diff**: It is in your context. A file whose patch was omitted for size is still listed; read it from the checkout with `read_file` when its name suggests it matters (a workflow, a config file, a lockfile whose companion manifest changed).
3. **Follow the data past the hunk**: For every place the change takes input or produces output, find where the input comes from and where the output goes, in the checkout. `grep` for the callers of a changed function; open the middleware in front of a new route; find where a new environment variable is read. A hunk that looks safe in isolation may be safe only because of a check that lives elsewhere, and a hunk that looks dangerous may be behind one. Say which case applies, and cite the check.
4. **Check the list**: `references/checklist.md` names the concrete patterns to look for, by kind of change. Go through the sections that apply.
5. **Confirm before you report**: A finding needs three things you can point at: the line, the attacker's move, and the reason the code allows it. If any is missing, it is not a finding. The attacker's move starts where untrusted input enters the code, so find that place too: the route, the handler argument, the webhook payload, the file or record a stranger can write. If the input comes only from the operator's own config or the server's own state, there is no attacker and no finding. A committed secret or a broken algorithm needs no entry point. After the findings you may add at most two notes, one sentence each, for things you could not confirm.
6. **Argue against each finding once**: Assume it is wrong and look for the reason before you write it.
   - Open the cited file at the cited line again. Check that the function, the variable and the path are there as you describe them. A finding about code that is not there is the worst thing a review can post.
   - Look for the strongest control between the entry and the sink: middleware, a schema, a parameterized call, an escaping renderer, a framework default. If it stops the attack, drop the finding.
   - If the change is itself a fix, ask whether it blocks the attack it targets. If it does, do not go looking for a different kind of attack to report instead.
   - Report the effect the code allows, not a stronger one. A crash is not code execution, an action on the caller's own data is not privilege gain, and a weakened control is not a bypassed one.
   - A file under `test`, `mock` or `example` is not safe because of its path. Check whether production code imports it or a route serves it.

   Whatever survives this is a finding.

7. **Write the review**: use the format below.

Never run anything. You cannot, and you must not describe having done so.

## Severity

- **Critical**: an attacker with no account runs code, reads or writes the whole data store, takes over other accounts, or gets a live secret. Examples: an unauthenticated route that executes input, a credential committed to the repository, a workflow that runs a fork's code with write tokens.
- **High**: an attacker fully defeats an explicit control, with real consequences. Examples: a missing ownership check on a record, SQL or a shell command built from a request field, a path from a request to the filesystem, a stored script that runs for other users.
- **Medium**: a real boundary violation that needs preconditions the attacker does not control, reaches only a narrow set of resources, or weakens a control without defeating it. Examples: a token that stops expiring, CORS opened to a wildcard, a check moved to the client.
- **Low**: internals that are not secret leak out, or the attack takes sustained effort for little gain. Examples: an error that echoes internals, a missing rate limit on a cheap endpoint.

To choose between High and Medium, ask whether the attack defeats the control or only weakens it. Severity never exceeds the damage you can state. If you cannot say what the attacker gets, the severity is lower than it feels, and the finding may not be one at all.

Severity measures impact and reachability, not code quality. These are not findings at any severity:

- A missing header, a hardening practice, or defense in depth, when no attacker can reach anything because of its absence.
- A standard safe API used as intended: a parameterized query, `JSON.parse`, the framework's escaping renderer.
- A misuse that needs another caller to pass bad arguments to a function that already handles them safely.
- Something you could not confirm. It gets no severity. The format below says where it goes.

## Format

The channel turns your reply into a GitHub review. The first line becomes the review's one-line body, and each finding block becomes an inline comment on the file its `File:` line names, so the reader sees each finding next to the code and resolves it there. Nothing you write between the first line and the first finding is posted. Write the reply in exactly this shape:

````text
Security review: 2 findings (1 high, 1 low).

### High · SQL built from a request field
File: src/db/users.ts:42

An attacker sends `id=1 OR 1=1` to `GET /users` and reads every row.

<details>
<summary>Why the code allows it, and what closes it</summary>

`req.query.id` reaches the query string by concatenation; the parameterized helper on line 12 is not used here.

</details>

```suggestion
const rows = await db.query("SELECT * FROM users WHERE id = $1", [Number(req.query.id)]);
```

Unverified suggestion. I do not run code, so read it before committing.

### Low · the error handler returns the stack to the client
File: src/server.ts:88

Return a generic message and log the stack instead.
````

Rules for the shape:

- The first line is always `Security review:` followed by the count, or `Security review: nothing to raise.` Nothing else goes before the first finding. The author knows what the change does, and what you checked and found safe is not a finding.
- A finding heading is `### <Severity> · <title>`, with the severity as Critical, High, Medium, or Low, and a title of one short clause that says what an attacker gets.
- The line after the heading is `File: path:line`, or `File: path` when you are not sure of the line. The path is the file's path in the repository. The line counts on the head commit, on the added or unchanged side of the diff; the channel checks it against the diff and moves it to the nearest changed line when it is off, so a rough line beats none, and none beats a line in a file the change does not touch.
- The visible part of a finding is the title and one sentence: the attacker's move. Everything else (why the code allows it, what closes it) goes inside `<details>`, so the comment scans in a glance and expands on demand.
- If, while writing the reasoning, you find yourself saying that an attacker gains nothing, or that the concern is code quality, it is not a finding. Delete the block; do not soften it to Low.
- Something you could not confirm is not a finding either. If it matters, write one sentence about it inside the `<details>` of the finding it bears on. On its own it is not posted.
- Add a `suggestion` block only when the fix fits in the lines you are anchored to and you are sure of it. Follow it with the unverified line, always. Never suggest a change you have not read the surrounding code for. When there is no suggestion, write nothing about it.
- Order findings by severity, highest first.

A clean review is one line, and at most one sentence after it naming what you read:

```text
Security review: nothing to raise.

Read the new endpoint, the `requireUser` middleware in front of it, and the one new dependency's manifest.
```

Write to the author. Say what you found, not what you did. Use no headings other than the finding headings, no emoji, and do not summarize the pull request back to the person who wrote it.
