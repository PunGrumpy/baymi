/**
 * The shape every commit a chase pushes must have.
 *
 * @remarks
 * The commits land on someone's branch under the App's name, so they read
 * like the maintainer's own: a Conventional Commits subject, a blank line,
 * and a body that says what failed and what changed. Nothing in them says
 * who or what wrote them beyond the App's author line: no co-author trailer
 * and no generated-by line. The model writes the message; this decides
 * whether it may be pushed.
 */

const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const;

const SUBJECT = new RegExp(
  `^(?:${TYPES.join("|")})(?:\\([\\w./-]+\\))?!?: \\S`,
  "u"
);

/** GitHub cuts a subject in its lists past this. */
export const MAX_SUBJECT_LENGTH = 72;

/** Lines that would mark the commit as written by a tool. */
const MARKERS: readonly RegExp[] = [
  /^co-authored-by:/imu,
  /generated (?:with|by) /iu,
  /\bai[- ]generated\b/iu,
  /🤖/u,
];

/** Everything wrong with a commit message, or none when it may be pushed. */
export const commitMessageProblems = (message: string): readonly string[] => {
  const problems: string[] = [];
  const [subject = "", separator, ...body] = message.trimEnd().split("\n");
  if (!SUBJECT.test(subject)) {
    problems.push(
      `The subject is not a Conventional Commit (${TYPES.join(", ")}): "${subject}".`
    );
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    problems.push(
      `The subject is ${subject.length} characters, more than ${MAX_SUBJECT_LENGTH}.`
    );
  }
  if (subject.endsWith(".")) {
    problems.push("The subject ends with a period.");
  }
  if (separator !== "" || body.every((line) => line.trim() === "")) {
    problems.push(
      "There is no body after a blank line saying what failed and what changed."
    );
  }
  for (const marker of MARKERS) {
    if (marker.test(message)) {
      problems.push(
        `The message carries a co-author or tool marker (${marker.source}).`
      );
    }
  }
  return problems;
};
