import { defineTool } from "eve/tools";
import { z } from "zod";

import { mintInstallationToken } from "#lib/github/credentials";
import { listInstalledRepositories } from "#lib/github/installation";

/**
 * The repositories the agent looks after, read back from the installation.
 *
 * @remarks
 * There is no configured list: the GitHub App's installation is the scope,
 * and this is how the model answers "which repositories do you watch?" or
 * checks whether one it was asked about is in reach before trying to read
 * it. Reads only, so it is mounted on every turn.
 */
export default defineTool({
  description:
    "List the repositories this agent is installed on, which is exactly the set it watches and can read. " +
    "Call it when asked which repositories you look after, or before working on a repository you have not touched in this conversation, to confirm it is in scope.",
  async execute() {
    const token = await mintInstallationToken();
    const repositories = await listInstalledRepositories(token);
    return { repositories: [...repositories] };
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    repositories: z.array(
      z.object({
        archived: z.boolean(),
        defaultBranch: z.string(),
        fullName: z.string(),
        private: z.boolean(),
      })
    ),
  }),
});
