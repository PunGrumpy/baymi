---
description: "How to compose or revise the weekly digest of a repository's open issues, posted in Slack: opening line, grouping, one-line issue summaries, needs-attention and stale criteria, citation format, and the closing invitation to reply in the thread. Load when composing this week's digest or reworking a draft of it. Not for other Slack messages, replies, or GitHub and Linear comments."
---

# Digest Format

The weekly digest is one Slack message a maintainer skims. Everything here serves that: short, grouped, every issue cited as #N with a link, and a clear way to act by replying in the thread.

## Before composing

- Check the user's saved preferences first. A preference like "group the digest by label" or a preferred level of detail overrides the defaults below; everything a preference doesn't cover follows this skill.
- Work only from issues fetched in this run. Never carry over counts, titles, or numbers from earlier context.

## Opening line

- Name the repository and anchor the week: "Weekly issues digest: owner/repo" followed by the date, for example "Weekly issues digest: acme/widgets, June 22 2026".
- If a scheduled task dictates an exact opening format, follow the task; it wins over this default.

## Structure

The first line after the opening carries the week. One line, holding three things: how many issues are open, what moved (new, closed), and the single item that most needs the maintainer, named with its number. Someone who reads nothing else should have read the thing that mattered. A theme worth a sentence gets a second line, and only when there is one; there usually is not.

The whole digest is at most 15 lines. Not a target, a ceiling. Past it a Slack message stops being skimmed and starts being scrolled, which is the same as unread. When the issues do not fit, cut from the bottom group up and say what was cut: `Stale (12), 5 oldest below`. Never shrink the lines themselves to fit more in.

Default grouping, in this order, each heading carrying its count so the shape of the week is legible before a single line is read:

1. **Needs attention (n):** issues a maintainer should look at first.
2. **Recent activity (n):** new this week or updated this week, ordered by most recent activity.
3. **Stale (n):** open with no activity in 30 or more days. List the five oldest and give a count for the rest.

When the user prefers a different grouping (by label, by assignee, by milestone), use theirs and keep the needs-attention issues at the top of whatever group they land in, marked as such.

Skip any group that would be empty rather than showing an empty heading.

An empty result is reported in as few words as it deserves, never apologised for and never padded to look like work. A repository with no open issues gets the opening line and one short sentence, and that is the whole digest. Do not add what did not happen ("nothing new came in", "nothing is waiting on anyone"), do not offer consolation work nobody asked for, and do not explain why there is nothing to say. Volume should track what there is to report, so a quiet week reads as quiet at a glance.

## What qualifies where

Needs attention, any of:

- Labeled as urgent by the repo's own convention (bug plus high-priority, regression, security, or similar).
- A question or report from a user that has sat without a maintainer response for a week or more.
- Heated or fast-moving: many new comments in the past week with no resolution.
- Blocking something the thread names: a release, another issue, a downstream user.

Stale: no comments, label changes, or other activity in 30 or more days. Staleness is about silence, not age; an old issue with fresh discussion belongs in recent activity.

An issue appears in exactly one group. Needs attention wins over the others.

## Summarizing an issue in one line

Every line has the same three parts in the same order, so the eye can run down the left edge and the reader can stop at any point without losing the thread:

```
[#42](link) Crash on empty config: fix proposed, awaiting review
 ^number     ^what it is             ^where it stands
```

The number comes first on every line, never after the title and never inside a sentence. It is what replies are written against, and a column of numbers is what makes the message scannable rather than a paragraph in list clothing.

- The state of play is where the thread stands now, not a recap: "fix proposed, awaiting review", "reporter went quiet after repro request", "two users confirmed on 3.2".
- For a long or noisy thread, read the most recent maintainer or reporter comments and state the current position; skip the back-and-forth that led there.
- Never paste issue bodies or comment text. Numbers help ("14 comments this week") when the volume itself is the news.

Titles are tightened, not quoted. Drop a prefix the group already carries (`[bug]`, `Bug:`) and cut a title down to what distinguishes this issue from the one above it.

## Citations

- Cite every issue by number in #N form, and make the #N a link to the issue on GitHub. The number is what readers use in replies ("create Linear issues for #1 and #2"), so it must be present and correct on every mention.
- Use only numbers and links from issues fetched this run. Never guess or reconstruct a URL.

## Scannability

- The reader is skimming a Slack message. Bold group names, one line per issue, no walls of text.
- Keep the overview to one paragraph and each issue to one line. If an issue truly needs more, one extra clause beats a second paragraph.
- Write plain Markdown; the channel converts it for Slack. Bold and links carry over, headings and tables have no Slack equivalent, so use bold group names and flat lists, nothing heavier.
- One blank line between groups and none inside one. A group whose lines are spaced out reads as several groups.

## Closing

One line, and only when there is something to act on. Name the concrete options (ask for detail on an issue, comment on one, create Linear issues from it) against a real number from this digest: "Reply to act, e.g. 'create Linear issues for #12 and #17'".

This is not a fixed footer. The maintainer reads this digest every week and learned the reply pattern the first time; repeating it verbatim 52 times a year turns the last line into something the eye skips, which is a poor place for the one instruction that matters. A quiet week with nothing worth acting on ends after its last group.
