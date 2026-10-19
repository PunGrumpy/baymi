/**
 * Measures how many planted flaws a model finds, and how many clean diffs it
 * flags, with the instructions a production review runs on.
 *
 * @remarks
 * One `generateText` call per case through AI Gateway, with no tools, the
 * way eve calls the model. The system prompt is `agent/instructions.md`, the
 * unattended review fragment, and the `security-review` skill with its
 * checklist, as if `load_skill` had already run. That keeps a run to one
 * request per case, where a full agent turn sends several. It measures what
 * the model makes of the diff, not whether it opens the checkout.
 * `--prompt minimal` swaps all of that for one sentence and the skill's
 * format section, to tell the model's limits from the prompt's.
 *
 * Replies are scored with `parseReview`, the parser the GitHub channel uses,
 * so a reply production would not post as a review scores as unparsed.
 * Cases run one at a time, interleaved across models, because concurrency
 * invalidated earlier measurements here (`docs/notes.md`). The model that
 * served each reply is logged, because a provider can answer a retired id
 * with another model. Every reply is written to `.eve/review-bench/`.
 *
 * Run: `bun scripts/review-bench.ts [--rounds 1] [--case name]
 * [--prompt production|minimal] model...` with `AI_GATEWAY_API_KEY`, or
 * `VERCEL_OIDC_TOKEN` from `vercel env pull`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { generateText } from "ai";

import { parseReview } from "#lib/github/review";

import type { BenchCase } from "./review-bench/cases";
import { CASES } from "./review-bench/cases";

interface Tokens {
  readonly input: number;
  readonly output: number;
}

type Verdict = "hit" | "miss" | "clean" | "false-positive" | "unparsed";

interface Result {
  readonly case: string;
  readonly model: string;
  readonly prompt: PromptName;
  readonly reply: string;
  readonly round: number;
  readonly served: string | undefined;
  readonly tokens: Tokens | undefined;
  readonly verdict: Verdict | "error";
}

const REPORTED = new Set(["critical", "high", "medium"]);

const score = (benchCase: BenchCase, reply: string): Verdict => {
  const review = parseReview(reply);
  if (!review) {
    return "unparsed";
  }
  const reported = review.findings.filter((finding) =>
    REPORTED.has(finding.severity)
  );
  if (benchCase.kind === "clean") {
    return reported.length === 0 ? "clean" : "false-positive";
  }
  const found = reported.some(
    (finding) =>
      finding.path.endsWith(benchCase.path) &&
      benchCase.flaw.test(`${finding.title}\n${finding.body}`)
  );
  return found ? "hit" : "miss";
};

const REVIEW_FRAGMENT = /const CONTENT = `(?<content>[\s\S]+?)`;/u;

const reviewFragment = async (): Promise<string> => {
  const source = await readFile("agent/instructions/review.ts", "utf-8");
  const content = REVIEW_FRAGMENT.exec(source)?.groups?.content;
  if (!content) {
    throw new Error("agent/instructions/review.ts no longer holds CONTENT");
  }
  return content.replaceAll("\\`", "`");
};

const skill = await readFile("agent/skills/security-review/SKILL.md", "utf-8");

const FORMAT_SECTION = skill.slice(skill.indexOf("## Format"));
if (!FORMAT_SECTION.startsWith("## Format")) {
  throw new Error("the security-review skill no longer has a Format section");
}

const PRODUCTION = [
  await readFile("agent/instructions.md", "utf-8"),
  await reviewFragment(),
  "# The security-review skill, loaded",
  skill,
  await readFile(
    "agent/skills/security-review/references/checklist.md",
    "utf-8"
  ),
].join("\n\n");

const MINIMAL = [
  "You review one pull request diff for security vulnerabilities. Report every vulnerability the change introduces that an attacker could exploit, with the file and line. Do not comment on style or performance.",
  FORMAT_SECTION,
].join("\n\n");

const PROMPTS = { minimal: MINIMAL, production: PRODUCTION } as const;

type PromptName = keyof typeof PROMPTS;

const isPromptName = (name: string): name is PromptName => name in PROMPTS;

const { positionals: models, values } = parseArgs({
  allowPositionals: true,
  options: {
    case: { multiple: true, type: "string" },
    prompt: { default: ["production"], multiple: true, type: "string" },
    rounds: { default: "1", type: "string" },
  },
});

if (models.length === 0) {
  throw new Error("name at least one model");
}

const prompts = values.prompt.filter(isPromptName);
if (prompts.length !== values.prompt.length) {
  throw new Error(`--prompt takes ${Object.keys(PROMPTS).join(" or ")}`);
}

const rounds = Number(values.rounds);

type Outcome =
  | {
      readonly kind: "answered";
      readonly reply: string;
      readonly served: string;
      readonly tokens: Tokens;
    }
  | { readonly error: string; readonly kind: "failed" };

const review = async (
  model: string,
  prompt: PromptName,
  benchCase: BenchCase
): Promise<Outcome> => {
  try {
    const result = await generateText({
      maxOutputTokens: 16_000,
      model,
      prompt: `Review pull request acme/web#12, just opened. The security-review skill is already loaded, and this turn has no checkout and no tools, so review from the diff alone. Its diff:\n\n\`\`\`diff\n${benchCase.diff}\n\`\`\``,
      reasoning: "high",
      system: PROMPTS[prompt],
    });
    return {
      kind: "answered",
      reply: result.text,
      served: result.response.modelId,
      tokens: {
        input: result.usage.inputTokens ?? 0,
        output: result.usage.outputTokens ?? 0,
      },
    };
  } catch (error) {
    return { error: String(error), kind: "failed" };
  }
};

const cases = values.case
  ? CASES.filter((benchCase) => values.case?.includes(benchCase.name))
  : CASES;

const results: Result[] = [];
const outDir = ".eve/review-bench";
await mkdir(outDir, { recursive: true });
const outFile = `${outDir}/${new Date().toISOString().replaceAll(":", "-")}.json`;

const jobs = Array.from({ length: rounds }, (_, index) => index + 1).flatMap(
  (round) =>
    cases.flatMap((benchCase) =>
      models.flatMap((model) =>
        prompts.map((prompt) => ({ benchCase, model, prompt, round }))
      )
    )
);

const runJob = async ({
  benchCase,
  model,
  prompt,
  round,
}: (typeof jobs)[number]): Promise<Result> => {
  const outcome = await review(model, prompt, benchCase);
  const shared = { case: benchCase.name, model, prompt, round };
  if (outcome.kind === "failed") {
    return {
      ...shared,
      reply: outcome.error,
      served: undefined,
      tokens: undefined,
      verdict: "error",
    };
  }
  return {
    ...shared,
    reply: outcome.reply,
    served: outcome.served,
    tokens: outcome.tokens,
    verdict: score(benchCase, outcome.reply),
  };
};

for (const job of jobs) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time, interleaved, is the point
  const result = await runJob(job);
  results.push(result);
  // oxlint-disable-next-line eslint/no-await-in-loop -- keeps every reply if the run dies
  await writeFile(outFile, JSON.stringify(results, null, 2));
  process.stdout.write(
    `round ${job.round} ${job.benchCase.name} ${job.model} ${job.prompt}: ${result.verdict} tokens ${result.tokens ? `${result.tokens.input} in, ${result.tokens.output} out` : "?"} served by ${result.served ?? "?"}\n`
  );
}

process.stdout.write(
  "\nmodel\tprompt\thit\tmiss\tclean\tfalse+\tunparsed\terror\tin\tout\n"
);
for (const model of models) {
  for (const prompt of prompts) {
    const own = results.filter(
      (result) => result.model === model && result.prompt === prompt
    );
    const count = (verdict: Result["verdict"]) =>
      own.filter((result) => result.verdict === verdict).length;
    const sum = (pick: (tokens: Tokens) => number) =>
      own.reduce(
        (total, result) => total + (result.tokens ? pick(result.tokens) : 0),
        0
      );
    process.stdout.write(
      `${model}\t${prompt}\t${count("hit")}\t${count("miss")}\t${count("clean")}\t${count("false-positive")}\t${count("unparsed")}\t${count("error")}\t${sum((tokens) => tokens.input)}\t${sum((tokens) => tokens.output)}\n`
    );
  }
}
process.stdout.write(`\nreplies: ${outFile}\n`);
