---
description: "Procedure for attaching visual evidence to a pull request: deciding what before and after are, capturing both with capture_before_after, and what to do when the preview is protected or there is no before at all. Load when a change is visual, when someone asks for screenshots or a visual diff, or before opening a pull request that touches a rendered surface. Not for a change that only touches code nobody sees."
---

# Before/after captures

Two of the repositories this agent follows deploy a site: `logixlysia` (`apps/docs`) and `docker-doctor` (`apps/web`). A change to a page in either one is a change a reviewer has to take on faith unless they see it.

One tool does the whole capture. `capture_before_after` screenshots both URLs in the sandbox, uploads both frames, and returns the markdown table ready to paste into the pull request body. There is nothing to assemble by hand and nothing to upload separately.

## When this earns its place

- The change alters something already rendered: a layout, a component, a style, a page's copy in a place the reader sees it.
- **A pure addition has no before.** When the change adds a page or a section that did not exist, the two frames compare a page to a page and the reader learns nothing. Capture nothing, describe the new thing in prose, and say what it sits next to.
- A change to a build script, a test, a type, or a dependency is not visual, even when it touches a repository that has a site.

## What before and after are

- **Before is the current deployed page**, not a reconstruction. Never switch branches, stash, or revert to fabricate one.
- **After is the branch's Vercel preview** when the pull request has one.
- **The current state of the code is after.** If the two ever seem swapped, stop and work out which is which rather than labelling the table by guess.

Only `*.vercel.app` deployments and a `localhost` dev server can be captured. The tool refuses anything else outright, and that refusal is the boundary, not an obstacle to route around: a capture reaches its target from inside the sandbox and publishes what it finds at a public URL.

## When the preview is protected

Vercel Deployment Protection answers before the app does, so a protected preview returns 401 or redirects to a login flow and there is nothing to capture. Probe it first:

```bash
curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 '<preview-url>'
```

A 401, a 403, or a redirect that leaves the deployment means protected. Then fall back to a dev server: start it in the checkout as soon as the branch exists, before running the repository's checks, so it warms while lint, typecheck and tests run.

```bash
cd /workspace/repo && bun run dev > /tmp/dev.log 2>&1 &
```

Confirm it answers before capturing, and use the port it actually bound.

## In the pull request

Put the table in the body under a short heading, after the description of what changed. One pair per pull request unless the change genuinely lands in two places; a wall of screenshots is not evidence, it is a scroll.

Say what the reader is meant to notice. A table with no sentence pointing at the difference asks the reviewer to play spot-the-difference.

## What not to do

- Do not capture a page that can show real user data.
- Do not paste a capture into an issue thread nobody asked for one in.
- Do not describe a visual change as verified when the capture failed. Say the capture failed and why.
