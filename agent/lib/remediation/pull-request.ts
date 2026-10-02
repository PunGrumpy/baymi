import type { CheckResult, Verdict } from "#lib/remediation/checks";
import { tail } from "#lib/remediation/checks";
import type { RemediationTask } from "#lib/remediation/task";

/**
 * The title, commit message and body of a remediation's draft pull request.
 *
 * @remarks
 * The body says first whether the fix is verified, because that decides how
 * much reading it needs. An unverified mitigation lists every reason, and a
 * failed check carries the end of its output, so the person reviewing it
 * does not have to rerun anything to see what broke.
 */

/** Hidden marker on every remediation pull request Baymi opens. */
export const REMEDIATION_MARKER = "<!-- baymi:remediation -->";

/** Conventional Commits title for the bump. */
export const remediationTitle = (task: RemediationTask): string => {
  const from = [...new Set(task.vulnerable.map((entry) => entry.version))].join(
    ", "
  );
  return `fix(deps): bump ${task.packageName} from ${from} to ${task.fixedVersion ?? "a patched version"}`;
};

const advisoryLines = (task: RemediationTask): readonly string[] => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of task.vulnerable) {
    for (const advisory of entry.advisories) {
      if (seen.has(advisory.ghsa)) {
        continue;
      }
      seen.add(advisory.ghsa);
      const cve = advisory.cve === null ? "" : ` (${advisory.cve})`;
      lines.push(
        `- [${advisory.ghsa}](${advisory.url})${cve}, ${advisory.severity}: ${advisory.summary}. Fixed in ${advisory.firstPatchedVersion ?? "no release yet"}.`
      );
    }
  }
  return lines;
};

const checkLines = (results: readonly CheckResult[]): readonly string[] =>
  results.map((result) =>
    result.exitCode === 0
      ? `- \`${result.name}\`: passed.`
      : `- \`${result.name}\`: exited with ${result.exitCode}.`
  );

const failureOutput = (results: readonly CheckResult[]): readonly string[] =>
  results.flatMap((result) =>
    result.exitCode === 0
      ? []
      : [
          "",
          "<details>",
          `<summary>Output of \`${result.name}\`</summary>`,
          "",
          "```text",
          tail(result.output),
          "```",
          "",
          "</details>",
        ]
  );

/** The pull request body: verdict, advisories, the change, the checks. */
export const remediationBody = (input: {
  readonly notes: string;
  readonly results: readonly CheckResult[];
  readonly task: RemediationTask;
  readonly verdict: Verdict;
}): string => {
  const { notes, results, task, verdict } = input;
  const headline = verdict.verified
    ? "Verified: the project's checks passed on this exact change."
    : "Unverified mitigation: read it before merging.";
  const lines = [
    REMEDIATION_MARKER,
    headline,
    "",
    ...verdict.reasons.map((reason) => `- ${reason}`),
    ...(verdict.reasons.length > 0 ? [""] : []),
    "### Advisories",
    "",
    ...advisoryLines(task),
    "",
    "### What changed",
    "",
    notes.trim() || `Bumped ${task.packageName} to ${task.fixedVersion}.`,
    "",
    "### Checks",
    "",
    ...(results.length > 0 ? checkLines(results) : ["- None ran."]),
    ...failureOutput(results),
    "",
    `Opened by Baymi on request, from \`${task.defaultBranch}\` at ${task.baseSha.slice(0, 7)}. Lifecycle scripts were off during install.`,
  ];
  return lines.join("\n");
};
