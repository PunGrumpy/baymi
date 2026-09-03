---
description: "Procedure for attaching visual evidence to a pull request: deciding what before and after are, capturing both with capture_before_after (or the after alone for a new page), where the block goes in the body, and what to do when the preview is protected. Load when a change is visual, when someone asks for screenshots or a visual diff, or before opening a pull request that touches a rendered surface. Not for a change that only touches code nobody sees."
---

# Before/after captures

Two of the repositories this agent follows deploy a site: `logixlysia` (`apps/docs`) and `docker-doctor` (`apps/web`). A change to a page in either one is a change a reviewer has to take on faith unless they see it.

One tool does the whole capture. `capture_before_after` screenshots the URLs in the sandbox, uploads the frames, and returns a marked markdown block ready to paste into the pull request body. There is nothing to assemble by hand and nothing to upload separately.

## When this earns its place

- The change alters something already rendered: a layout, a component, a style, a page's copy in a place the reader sees it.
- **A pure addition has no before.** When the change adds a page or a section that did not exist, leave `before` out. The tool captures the after alone and renders it as a single **Preview** column. Never point `before` at some other page to fill the slot: two frames of different pages compare nothing.
- A change to a build script, a test, a type, or a dependency is not visual, even when it touches a repository that has a site.

## What before and after are

- **Before is the current deployed page**, not a reconstruction. Never switch branches, stash, or revert to fabricate one.
- **After is the branch's Vercel preview** when the pull request has one.
- **The current state of the code is after.** If the two ever seem swapped, stop and work out which is which rather than labelling the table by guess.

The tool captures only `*.vercel.app` deployments and a `localhost` dev server. It refuses anything else outright, and that refusal is the boundary, not an obstacle to route around: the sandbox fetches the URL and the tool publishes the screenshot at a public URL.

## Framing the capture

- The default frame is the first viewport (1280×800). Pass `fullPage: true` when the change sits below the fold or when the page's length is the point. The table pins full-page frames to the top of their cells, so two pages of different length still line up at the top edge.
- Pass `selector` to scroll a component into view when the change is one region, rather than capturing a whole page the reader then has to search.
- Pass `viewport: "mobile"` when the change is responsive behaviour. Otherwise one desktop pair is enough.

## When the preview is protected

Vercel Deployment Protection answers before the app does, so a protected preview returns 401 or redirects to a login flow and there is nothing to capture. Probe it first:

```bash
curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 'https://preview_url_here'
```

A 401, a 403, or a redirect that leaves the deployment means protected. Then fall back to a dev server: start it in the checkout as soon as the branch exists, before running the repository's checks, so it warms while lint, typecheck and tests run.

```bash
cd /workspace/repo && bun run dev > /tmp/dev.log 2>&1 &
```

Confirm it answers before capturing, and use the port it actually bound.

## In the pull request

The tool fences the block in `<!-- before-and-after:start -->` and `<!-- before-and-after:end -->`. Paste it whole, markers included, and never edit inside it: the markers are how a later editor finds the block instead of the prose around it.

Put it near the top of the body: after the one or two sentences that say what the change is and after any preview or deployment link, and before the sections that explain how (details, changes, testing, notes). A reviewer should see the evidence before the implementation.

One block per pull request unless the change appears in two places. A wall of screenshots is not evidence, it is a scroll.

Say what the reader is meant to notice, in a sentence next to the block. A table with no sentence pointing at the difference asks the reviewer to play spot-the-difference.

A capture taken later on the same pull request, after a review round, goes in your reply on the thread. No tool here edits a pull request body, so do not paste a second block into it by other means.

## What not to do

- Do not capture a page that can show real user data.
- Do not paste a capture into an issue thread nobody asked for one in.
- Do not describe a visual change as verified when the capture failed. Say the capture failed and why.
