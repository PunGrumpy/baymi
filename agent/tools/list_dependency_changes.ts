import { defineTool } from "eve/tools";
import { z } from "zod";

import { mintInstallationToken } from "#lib/github/credentials";
import {
  readDependencyChanges,
  REPOSITORY_PATTERN,
} from "#lib/github/dependencies";

const ADVISORY = z.object({
  ghsa: z.string(),
  severity: z.string(),
  summary: z.string(),
  url: z.string(),
});

/**
 * The dependencies a pull request adds, with the GitHub advisories against
 * each added version.
 *
 * @remarks
 * The lookup is GitHub's dependency review (`#lib/github/dependencies`), so
 * the agent matches no CVE itself and fetches no URL. The tool answers
 * `available: false` with a reason when the repository has dependency review
 * off, and the review goes on without it. Reads only, so it is mounted on
 * every turn; the installation token reaches only the repositories the App is
 * installed on.
 */
export default defineTool({
  description:
    "List the dependencies a pull request adds or removes, and the published security advisories (GHSA and CVE) against each added version. " +
    "Call it when the change touches a dependency manifest or lockfile. It tells you which added versions are vulnerable; you still decide from the code whether the vulnerable function is reached.",
  async execute({ pullRequestNumber, repository }) {
    const token = await mintInstallationToken();
    return await readDependencyChanges({
      pullRequestNumber,
      repository,
      token,
    });
  },
  inputSchema: z.object({
    pullRequestNumber: z.number().int().positive(),
    repository: z
      .string()
      .regex(REPOSITORY_PATTERN)
      .describe("The repository as owner/name."),
  }),
  outputSchema: z.discriminatedUnion("available", [
    z.object({
      added: z.number().int(),
      addedClean: z.array(z.string()),
      available: z.literal(true),
      removed: z.number().int(),
      vulnerable: z.array(
        z.object({
          advisories: z.array(ADVISORY),
          ecosystem: z.string(),
          manifest: z.string(),
          name: z.string(),
          scope: z.string(),
          version: z.string(),
        })
      ),
    }),
    z.object({ available: z.literal(false), reason: z.string() }),
  ]),
});
