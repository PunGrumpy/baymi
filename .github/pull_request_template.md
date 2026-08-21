<!---
☝️ The title follows Conventional Commits: lowercase subject, a scope from the
list below or none at all. Omit the scope when the change is cross-cutting.

### Types
- feat (adds a capability)
- fix (fixes a defect)
- refactor (neither fixes a defect nor adds a capability)
- perf (makes existing behaviour faster or cheaper)
- docs (documentation, skills, instructions)
- test (adds or updates tests or evals)
- build (build setup, bundling, deployment config)
- ci (workflows under .github/)
- chore (tooling and housekeeping)
- revert (reverts an earlier commit)

### Scopes
Point at one surface, or use no scope. This is the whole list; anything else
belongs in an earlier pull request that adds it here first.

- github (the GitHub channel and agent/lib/github)
- slack (the Slack channel and its instruction fragment)
- linear (the Linear channel and the Linear connection)
- digest (the weekly digest schedule and the digest-format skill)
- sandbox (agent/sandbox.ts and the sandbox checkout)
- tools (agent/tools)
- skills (agent/skills)
- instructions (agent/instructions.md and agent/instructions)
- evals (the eval suite)
- notes (docs/notes.md)
- brand (the brand package and the README banner)
- deps (dependency bumps)
- lint (the ultracite and oxlint configuration)
- package (package.json wiring: scripts, imports, metadata)
-->

### Issue

<!-- "Closes #12", or delete this section when nothing tracks it. -->

### What this does

<!-- What changed and why. The why is the part a reviewer cannot get from the diff. -->

### Checked

<!--
Every command, with its result. `bun run typecheck`, `bun run check` and
`bun run test` are what CI runs.

A check that failed, or that could not be run at all, is named here with the
reason. Never describe a check as passing because it usually passes.
-->

### Not covered

<!--
What this change does not do: a cause left standing behind a fixed symptom, a
claim no test reaches, a follow-up worth its own pull request. Delete the
section when there is nothing to say, rather than filling it.
-->
