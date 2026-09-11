import { z } from "zod";

/**
 * The repositories the GitHub App is installed on, which is everything
 * this agent watches.
 *
 * @remarks
 * There is no repository list to configure. GitHub only delivers webhooks
 * for repositories the App is installed on and only mints tokens that reach
 * them, so the installation is the scope, and this is how the agent reads
 * it back to answer "which repositories do you look after?".
 */

const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;
/** Enough for a person's account many times over; a bound, not a target. */
const MAX_PAGES = 10;

/** One repository, as the agent describes it. */
export interface InstalledRepository {
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly fullName: string;
  readonly private: boolean;
}

const INSTALLATION_PAGE = z.object({
  repositories: z.array(
    z.object({
      archived: z.boolean().default(false),
      default_branch: z.string(),
      full_name: z.string(),
      private: z.boolean(),
    })
  ),
  total_count: z.number().int().nonnegative(),
});

/** The one call this needs, narrowed so a test can supply one. */
export type FetchLike = (
  input: string,
  init: { readonly headers: Readonly<Record<string, string>> }
) => Promise<{
  readonly json: () => Promise<object>;
  readonly ok: boolean;
  readonly status: number;
}>;

/**
 * Lists every repository the installation token reaches, across pages.
 *
 * @remarks
 * Pages until the reported total is reached or the page cap is hit, whichever
 * comes first. The cap is a bound on a runaway loop, not a limit anyone
 * should reach: an installation with a thousand repositories is not one
 * person's.
 */
export const listInstalledRepositories = async (
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<readonly InstalledRepository[]> => {
  const repositories: InstalledRepository[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
    const response = await fetchImpl(
      `${GITHUB_API}/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      }
    );
    if (!response.ok) {
      throw new Error(
        `GitHub answered ${response.status} listing the installation's repositories.`
      );
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- pages are sequential by nature
    const parsed = INSTALLATION_PAGE.parse(await response.json());
    for (const repository of parsed.repositories) {
      repositories.push({
        archived: repository.archived,
        defaultBranch: repository.default_branch,
        fullName: repository.full_name,
        private: repository.private,
      });
    }
    if (
      parsed.repositories.length === 0 ||
      repositories.length >= parsed.total_count
    ) {
      break;
    }
  }
  return repositories;
};
