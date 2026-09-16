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
5. **Confirm before you report**: A finding needs three things you can point at: the line, the attacker's move, and the reason the code allows it. If any is missing, it is not a finding. After the findings you may add at most two notes, one sentence each, for things you could not confirm.
6. **Write the review**: use the format below.

Never run anything. You cannot, and you must not describe having done so.

## Severity

- **Critical**: exploitable without authentication, or leaks a secret, or runs attacker code: an unauthenticated route that executes input, a credential committed to the repository, a workflow that runs a fork's code with write tokens.
- **High**: an authenticated user reaches what is not theirs, or injection with a realistic path from input to sink: a missing ownership check on a record, SQL or command built from a request field, a path from a request to the filesystem.
- **Medium**: exploitable only with preconditions the attacker does not control, or a real weakening of a defense: a token that stops expiring, CORS opened to a wildcard, a check moved to the client.
- **Low**: defense in depth, or a practice that will become a finding as the code grows: an error that echoes internals, a missing rate limit on a cheap endpoint.

Severity measures impact and reachability, not code quality.

## Format

The channel turns your reply into a GitHub review. The first line becomes the review's one-line body, and each finding block becomes an inline comment on the file its `File:` line names, so the reader meets each finding next to the code and resolves it there. There is no summary: nothing you write between the first line and the first finding is posted. Write the reply in exactly this shape:

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

- The first line is always `Security review:` followed by the count, or `Security review: nothing to raise.` Nothing else goes before the first finding: no description of the change, no list of what you checked, no advice. The author knows what the change does, and what you checked and found safe is not a finding.
- A finding heading is `### <Severity> · <title>`, with the severity as Critical, High, Medium, or Low, and a title of one short clause that says what an attacker gets.
- The line after the heading is `File: path:line`, or `File: path` when you are not sure of the line. The path is the file's path in the repository. The line counts on the head commit, on the added or unchanged side of the diff; the channel checks it against the diff and moves it to the nearest changed line when it is off, so a rough line beats none, and none beats a line in a file the change does not touch.
- The visible part of a finding is the title and one sentence: the attacker's move. Everything else (why the code allows it, what closes it) goes inside `<details>`, so the comment scans in a glance and expands on demand.
- If, while writing the reasoning, you find yourself saying that an attacker gains nothing, or that the concern is code quality, it is not a finding. Delete the block; do not soften it to Low.
- Something you could not confirm is not a finding either. If it matters, it goes inside the `<details>` of the finding it bears on, in one sentence; on its own it is not posted.
- Add a `suggestion` block only when the fix fits in the lines you are anchored to and you are sure of it. Follow it with the unverified line, always. Never suggest a change you have not read the surrounding code for. When there is no suggestion, write nothing about it.
- Order findings by severity, highest first.

A clean review is one line, and at most one sentence after it naming what you read:

```text
Security review: nothing to raise.

Read the new endpoint, the `requireUser` middleware in front of it, and the one new dependency's manifest.
```

Write to the author. Say what you found, not what you did. Use no headings other than the finding headings, no emoji, and do not summarize the pull request back to the person who wrote it.
