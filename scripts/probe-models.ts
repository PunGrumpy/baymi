/**
 * Asks each model, through the proxy, whether it calls the tools it is shown,
 * and records what each request spent in credits.
 *
 * @remarks
 * Two scenarios, each shaped like a real first turn: the review (the root
 * instructions, a pull request and the review's tools) and remediation (the
 * subagent's instructions, a fix request and its tools). A round sends one
 * request per model per scenario, one at a time and interleaved across
 * models, because concurrent load and back-to-back runs of one model have
 * produced readings that did not hold (`docs/notes.md`).
 *
 * With no model named it probes the catalog's free chat models, which spend
 * no credits. A paid model has to be named and needs `--allow-paid`.
 *
 * Run: `bun scripts/probe-models.ts [--rounds 3] [--allow-paid] [model...]`
 * with `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` set as for the agent.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

type Outcome =
  | { kind: "answered"; called: string[]; spent: number | undefined }
  | { kind: "failed"; error: string };

const stringProps = (...names: string[]) => ({
  properties: Object.fromEntries(
    names.map((name) => [name, { type: "string" as const }])
  ),
  required: names,
  type: "object",
});

const modelsSchema = z.object({
  data: z.array(
    z.object({
      free: z.boolean(),
      id: z.string(),
      kind: z.string(),
      ready: z.boolean(),
    })
  ),
});

const messageSchema = z.object({
  content: z.array(
    z.union([
      z.object({ name: z.string(), type: z.literal("tool_use") }),
      z.object({ type: z.string() }),
    ])
  ),
  usage: z
    .object({
      credits: z.object({ spent: z.number().optional() }).optional(),
    })
    .optional(),
});

// The diff avoids `eval()`, `document.cookie` and `document.write`, because
// the AI Pass edge refuses a prompt that contains them before any model runs
// (`docs/notes.md`).
const DIFF = `diff --git a/src/users.ts b/src/users.ts
+export const findUser = (db: Db, req: Request) => {
+  const name = new URL(req.url).searchParams.get("name") ?? "";
+  return db.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
+};`;

const SCENARIOS = [
  {
    name: "review",
    prompt: `Review pull request acme/web#12. Its diff:\n\n${DIFF}`,
    system: await readFile("agent/instructions.md", "utf-8"),
    tools: [
      {
        description: "Load a skill's instructions by name.",
        input_schema: stringProps("name"),
        name: "load_skill",
      },
      {
        description: "Read a file from the repository checkout.",
        input_schema: stringProps("path"),
        name: "read_file",
      },
      {
        description: "List the dependencies a pull request adds or changes.",
        input_schema: stringProps("repository", "pull_number"),
        name: "list_dependency_changes",
      },
    ],
  },
  {
    name: "remediation",
    prompt: "Fix the vulnerable lodash dependency in acme/web.",
    system: await readFile(
      "agent/subagents/remediation/instructions.md",
      "utf-8"
    ),
    tools: [
      {
        description:
          "Resolve the fix task and unpack the default branch into the sandbox.",
        input_schema: stringProps("repository", "package"),
        name: "prepare_checkout",
      },
      {
        description: "Run a shell command in the sandbox.",
        input_schema: stringProps("command"),
        name: "bash",
      },
      {
        description: "Run the install and the project's checks.",
        input_schema: stringProps(),
        name: "run_checks",
      },
    ],
  },
];

type Scenario = (typeof SCENARIOS)[number];

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const baseUrl = env("ANTHROPIC_BASE_URL").replace(/\/$/u, "");
const headers = {
  authorization: `Bearer ${env("ANTHROPIC_API_KEY")}`,
  "content-type": "application/json",
  "x-thaipass-app": "baymi-model-probe",
};

const freeChatModels = async (): Promise<string[]> => {
  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) {
    throw new Error(`GET /models answered ${response.status}`);
  }
  const body = modelsSchema.parse(await response.json());
  return body.data
    .filter((model) => model.kind === "chat" && model.free && model.ready)
    .map((model) => model.id);
};

const probe = async ({
  model,
  scenario,
}: {
  model: string;
  scenario: Scenario;
}): Promise<Outcome> => {
  const response = await fetch(`${baseUrl}/messages`, {
    body: JSON.stringify({
      max_tokens: 4096,
      messages: [{ content: scenario.prompt, role: "user" }],
      model,
      output_config: { effort: "high" },
      system: scenario.system,
      thinking: { budget_tokens: 4096, type: "enabled" },
      tools: scenario.tools,
    }),
    headers,
    method: "POST",
  });
  if (!response.ok) {
    return {
      error: `${response.status} ${await response.text()}`,
      kind: "failed",
    };
  }
  const body = messageSchema.parse(await response.json());
  return {
    called: body.content.flatMap((block) =>
      "name" in block ? [block.name] : []
    ),
    kind: "answered",
    spent: body.usage?.credits?.spent,
  };
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "allow-paid": { default: false, type: "boolean" },
    rounds: { default: "3", type: "string" },
  },
});

const free = await freeChatModels();
const models = positionals.length > 0 ? positionals : free;
const paid = models.filter((model) => !free.includes(model));
if (paid.length > 0 && !values["allow-paid"]) {
  throw new Error(
    `Paid models spend credits: ${paid.join(", ")}. Pass --allow-paid to probe them.`
  );
}

const results = new Map<string, Outcome[]>();
const rounds = z.coerce.number().int().positive().parse(values.rounds);
for (let round = 1; round <= rounds; round += 1) {
  for (const scenario of SCENARIOS) {
    for (const model of models) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time, interleaved, is the point
      const outcome = await probe({ model, scenario });
      const key = `${model}\t${scenario.name}`;
      results.set(key, [...(results.get(key) ?? []), outcome]);
      const verdict =
        outcome.kind === "failed"
          ? `error ${outcome.error.slice(0, 120)}`
          : `called [${outcome.called.join(", ")}] spent ${outcome.spent ?? "?"}`;
      process.stdout.write(
        `round ${round} ${scenario.name} ${model}: ${verdict}\n`
      );
    }
  }
}

process.stdout.write("\nmodel\tscenario\tcalled\tavg credits\n");
for (const [key, outcomes] of results) {
  const answered = outcomes.filter((outcome) => outcome.kind === "answered");
  const called = answered.filter((outcome) => outcome.called.length > 0);
  const spent = answered
    .map((outcome) => outcome.spent)
    .filter((value) => value !== undefined);
  const average =
    spent.length > 0
      ? (spent.reduce((sum, value) => sum + value, 0) / spent.length).toFixed(1)
      : "?";
  process.stdout.write(
    `${key}\t${called.length}/${outcomes.length}\t${average}\n`
  );
}
