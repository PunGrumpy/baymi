/**
 * What the identity eval accepts as "says it is the engineering lead" and
 * "says it reviews for security".
 *
 * @remarks
 * Kept apart from the eval so a unit test can pin them without a model. The
 * lead role is accepted in the title's words or in what the role does: a
 * reply that says it "leads open pull requests toward merge" or "owns the
 * loop" describes the same job, and one run in three said exactly that and
 * not "engineering lead". The security half stays strict on purpose. A reply
 * that only says it "reviews pull requests" has left out the review this
 * agent is for.
 *
 * Each pattern also accepts the Thai words, because a reply to the owner is
 * in Thai.
 */

const ROLE_WORDS = [
  "engineering lead",
  String.raw`\b(?:i|baymi|who|that)\s+leads?\b[^.\n]{0,60}\bpull requests?\b`,
  String.raw`\bleading\b[^.\n]{0,60}\bpull requests?\b`,
  String.raw`\bowns? the loop\b`,
  String.raw`\bchas(?:e|es|ing)\b[^.\n]{0,60}\bmerge\b`,
  "หัวหน้า",
  "วิศวกร",
];

const SECURITY_WORDS = [
  String.raw`\bsecurity\b`,
  String.raw`\bvulnerabilit`,
  "ความปลอดภัย",
  "ช่องโหว่",
];

/** The reply says it leads the work on pull requests. */
export const LEAD_ROLE = new RegExp(ROLE_WORDS.join("|"), "iu");

/** The reply says it reviews for security. */
export const SECURITY_REVIEW = new RegExp(SECURITY_WORDS.join("|"), "iu");
