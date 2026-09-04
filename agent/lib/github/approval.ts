import type { GithubWriteToolName } from "@github-tools/sdk/eve-runtime";
import type { SessionAuthContext } from "eve/context";
import type { ApprovalStatus } from "eve/tools/approval";
import { z } from "zod";

import { isAutonomous, MAINTAINER_GITHUB_LOGIN } from "#lib/trust";

/**
 * Who answers for a GitHub write, decided from the session rather than from the
 * tool name alone.
 *
 * @remarks
 * Two questions, in order. Is anyone there? An unattended triage turn has no
 * one to ask: an approval prompt on that turn is posted as a comment on a
 * stranger's issue and then waits for an answer nobody knows to give, so every
 * write it reaches for is refused outright instead. Then, for a turn someone
 * started: what does this write leave behind for someone else to find? The
 * comment a session exists to post and the labels a triage pass applies are
 * the substance of the reply and are reversible in one click, so gating them
 * would strand the thread; everything durable keeps its approval card.
 *
 * The lists are exhaustive over `GITHUB_WRITES`, and the colocated test is
 * what holds them that way. A write with no entry here falls back to the
 * extension's default, which is an approval card, and that is exactly the
 * prompt an unattended turn cannot answer.
 */

/** Why an unattended turn is refused a write rather than asked about one. */
export const AUTONOMOUS_WRITE_DENIAL =
  "This turn is unattended: it may read, post its one reply, place labels, and hand the issue to the maintainer. Say what you would have done beyond that in the reply and leave it there.";

const DENIED: ApprovalStatus = {
  reason: AUTONOMOUS_WRITE_DENIAL,
  type: "denied",
};

/**
 * The writes that carry a conversation: the comment answering the thread, the
 * labels placing an issue, the assignment routing it. An attended turn runs
 * these without a card.
 *
 * @remarks
 * Assignment sits here rather than in `GATED_WRITES` for the reason labels do:
 * it is one click to undo and it is part of placing an issue, not a durable
 * artefact someone else has to live with. Every attended turn on this channel
 * already belongs to someone the repository trusts, so a card would confirm
 * what the mention gate confirmed.
 */
export const CONVERSATION_WRITES = [
  "addIssueComment",
  "addPullRequestComment",
  "removeAssignees",
  "removeLabel",
] as const satisfies readonly GithubWriteToolName[];

/**
 * The other mounted writes, `createPullRequest` aside. Each puts something
 * durable in front of someone else, so an attended turn confirms it on a card
 * first.
 */
export const GATED_WRITES = [
  "closeIssue",
  "createIssue",
] as const satisfies readonly GithubWriteToolName[];

/**
 * The writes an unattended turn may reach on its own, beyond the two decided
 * from their payload below.
 *
 * @remarks
 * The turn cannot answer a card, so these are not asked about; they are
 * allowed outright, which is the stronger claim and is why the list is one
 * entry long. Placing an issue in the vocabulary the repository already uses
 * is reversible in a click and reaches nothing past the issue being answered.
 *
 * Three near-misses are out on purpose. `removeLabel` would let the turn
 * undo a maintainer's own triage. `removeAssignees` would let it un-escalate
 * what it just escalated. `createIssue` would open something new off a
 * stranger's text, and an issue nobody filed is an issue nobody closes.
 */
export const AUTONOMOUS_WRITES = [
  "addLabels",
] as const satisfies readonly GithubWriteToolName[];

/**
 * The slice of eve's `ApprovalContext` a write policy reads.
 *
 * @remarks
 * Narrower than the context eve passes, which is what makes these policies
 * callable from a test without standing up a session: a function that only
 * asks for the calling principal still satisfies `ApprovalPolicy`.
 */
export interface WriteApprovalContext {
  readonly session: {
    readonly auth: { readonly current: SessionAuthContext | null };
  };
  readonly toolInput?: WriteInput;
}

/** Every field any policy here reads off a tool call, in one shape. */
export interface WriteInput extends PullRequestInput, AssignInput, LabelInput {}

/**
 * The slice of a write tool's input these policies read.
 *
 * @remarks
 * `draft` is `unknown` rather than `boolean` because the value arrives from
 * the model, and the only thing that may follow from it is an exemption: the
 * policy tests for `true` and treats anything else, including a string
 * `"true"`, as not a draft.
 */
export interface PullRequestInput {
  readonly draft?: unknown;
}

/** A conversation write: refused when unattended, uncarded otherwise. */
export const conversationWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus => (isAutonomous(auth) ? DENIED : "not-applicable");

/**
 * A write an unattended turn may reach: allowed outright there, and uncarded
 * on an attended turn like the rest of placing an issue.
 */
export const autonomousWrite = (
  auth: SessionAuthContext | null
): ApprovalStatus =>
  isAutonomous(auth) ? "not-applicable" : conversationWrite(auth);

/** Any other write: refused when unattended, carded otherwise. */
export const gatedWrite = (auth: SessionAuthContext | null): ApprovalStatus =>
  isAutonomous(auth) ? DENIED : "user-approval";

/**
 * Opening a pull request, which runs without a card when the pull request is
 * a draft.
 *
 * @remarks
 * The branch is the durable part and it has already landed. `git_push` runs
 * uncarded on every turn a person started, so carding the pull request that
 * describes that branch confirms nothing the push did not. A draft cannot
 * merge, marking one ready stays a human act, and the review is the
 * confirmation. A pull request that is ready to merge still asks, whoever
 * asked for it.
 *
 * A scheduled sweep is the case that made this exemption necessary, and it is
 * no longer the only one. Someone can answer a card only while the session
 * that raised it is alive, and that fails from both ends. A sweep fires while
 * nobody is watching Slack. An attended turn that dies mid-flight leaves its
 * card behind, and the click then arrives for a session eve can no longer
 * find, which `docs/notes.md` records. Neither one is a confirmation.
 */
export const pullRequestWrite = (
  auth: SessionAuthContext | null,
  input: PullRequestInput | undefined
): ApprovalStatus => {
  if (isAutonomous(auth)) {
    return DENIED;
  }
  return input?.draft === true ? "not-applicable" : "user-approval";
};

/** What the extension is handed for one write tool. */
type WritePolicy = (ctx: WriteApprovalContext) => ApprovalStatus;

/** The slice of an assignment call these policies read. */
export interface AssignInput {
  readonly assignees?: unknown;
}

/**
 * Assigning, which an unattended turn may do to exactly one person.
 *
 * @remarks
 * The escalation an unattended turn is for: it read a stranger's issue, could
 * not answer it, and needs the maintainer to see it. Handing it to anyone else
 * would be the model choosing whose week to spend, from text it was told to
 * treat as untrusted, so the allowed set has one member and the check is on
 * the payload rather than on the prompt. A prompt is guidance; this is the
 * gate.
 *
 * `assignees` is `unknown` because the value comes from the model. An empty
 * list is refused too: it reads as an assignment but performs none, and an
 * escalation that quietly does nothing is worse than one that fails loudly.
 */
export const assignWrite = (
  auth: SessionAuthContext | null,
  input: AssignInput | undefined
): ApprovalStatus => {
  if (!isAutonomous(auth)) {
    return conversationWrite(auth);
  }
  const { assignees } = input ?? {};
  const onlyMaintainer =
    Array.isArray(assignees) &&
    assignees.length > 0 &&
    assignees.every(
      (assignee) => String(assignee).toLowerCase() === MAINTAINER_GITHUB_LOGIN
    );
  return onlyMaintainer
    ? "not-applicable"
    : {
        reason: `An unattended turn may assign ${MAINTAINER_GITHUB_LOGIN} and no one else.`,
        type: "denied",
      };
};

/** The slice of a label-creation call these policies read. */
export interface LabelInput {
  readonly color?: unknown;
  readonly description?: unknown;
  readonly name?: unknown;
}

const LABEL_NAME_MAX = 50;
const LABEL_DESCRIPTION_MAX = 100;
/**
 * Taxonomy-shaped names only: no padding, no URLs, no free-form prose.
 *
 * @remarks
 * Shape only. Length is the schema's `max` below, so there is one number to
 * change rather than two that must agree.
 */
const LABEL_NAME = /^[a-zA-Z0-9][\w .:@-]*$/u;
const LABEL_COLOR = /^[0-9a-fA-F]{6}$/u;

/** LF, CR, and the Unicode line and paragraph separators. */
const MULTILINE = /[\n\r\u2028\u2029]/u;

/** Whether a value carries no surrounding whitespace. */
const unpadded = (value: string): boolean => value === value.trim();

/**
 * The label payload an unattended turn is allowed to send.
 *
 * @remarks
 * The turn's input is a stranger's issue body, and nothing at this layer can
 * prove where a label name came from. What it can do is bound the shape, so
 * the worst case is a useless label rather than a sentence written into the
 * repository's taxonomy. Checked as given rather than trimmed and accepted: a
 * name with surrounding whitespace is not a name this turn meant. The name
 * pattern excludes the line separators outright, which is why there is no
 * separate multiline check for it.
 *
 * `nullish` on the description takes both an absent field and an explicit
 * null, which is what "no description" arrives as; anything else that is not a
 * short single line is refused.
 */
const LABEL_PAYLOAD = z.object({
  color: z.string().regex(LABEL_COLOR),
  description: z
    .string()
    .max(LABEL_DESCRIPTION_MAX)
    .refine(unpadded)
    .refine((value) => !MULTILINE.test(value))
    .nullish(),
  name: z.string().max(LABEL_NAME_MAX).regex(LABEL_NAME).refine(unpadded),
});

/** What to tell the model, per field the payload failed on. */
const LABEL_DENIALS = {
  color: "An unattended turn may create a label only with a 6-digit hex color.",
  description:
    "An unattended turn may create a label only with a short single-line description.",
  name: "An unattended turn may create a label only with a short taxonomy-shaped name, unpadded.",
} as const;

/**
 * Why this label creation is refused on an unattended turn, or null when its
 * shape is acceptable.
 */
export const autonomousLabelDenial = (
  input: LabelInput | undefined
): string | null => {
  const parsed = LABEL_PAYLOAD.safeParse(input);
  if (parsed.success) {
    return null;
  }
  // The default covers a payload that is not an object at all, whose issue
  // carries no field: a refusal, never an accept.
  const [field] = parsed.error.issues[0]?.path ?? [];
  switch (field) {
    case "color": {
      return LABEL_DENIALS.color;
    }
    case "description": {
      return LABEL_DENIALS.description;
    }
    default: {
      return LABEL_DENIALS.name;
    }
  }
};

/**
 * Creating a label, which an unattended turn may do when the payload is
 * taxonomy-shaped and an attended turn does uncarded.
 */
export const labelWrite = (
  auth: SessionAuthContext | null,
  input: LabelInput | undefined
): ApprovalStatus => {
  if (!isAutonomous(auth)) {
    return conversationWrite(auth);
  }
  const reason = autonomousLabelDenial(input);
  return reason ? { reason, type: "denied" } : "not-applicable";
};

const policyFor = (
  tools: readonly GithubWriteToolName[],
  decide: (auth: SessionAuthContext | null) => ApprovalStatus
): Partial<Record<GithubWriteToolName, WritePolicy>> =>
  Object.fromEntries(
    tools.map((tool) => [
      tool,
      (ctx: WriteApprovalContext) => decide(ctx.session.auth.current),
    ])
  );

/**
 * The per-tool approval map the GitHub extension is mounted with, built from
 * the two lists above so the classification is stated once.
 */
export const githubWriteApprovals = () => {
  const createPullRequest: WritePolicy = (ctx) =>
    pullRequestWrite(ctx.session.auth.current, ctx.toolInput);
  const addAssignees: WritePolicy = (ctx) =>
    assignWrite(ctx.session.auth.current, ctx.toolInput);
  const createLabel: WritePolicy = (ctx) =>
    labelWrite(ctx.session.auth.current, ctx.toolInput);
  return {
    ...policyFor(CONVERSATION_WRITES, conversationWrite),
    ...policyFor(GATED_WRITES, gatedWrite),
    ...policyFor(AUTONOMOUS_WRITES, autonomousWrite),
    addAssignees,
    createLabel,
    createPullRequest,
  };
};
