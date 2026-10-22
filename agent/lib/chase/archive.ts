/**
 * Downloads a repository at one commit as a gzipped tarball, in the app
 * runtime, so the token that can read a private repository never enters the
 * sandbox the bytes are written into.
 */

const GITHUB_API = "https://api.github.com";

/** A repository larger than this is not one a dependency bump should unpack. */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

/** The one call this needs, narrowed so a test can supply one. */
export type ArchiveFetch = (
  input: string,
  init: { readonly headers: Readonly<Record<string, string>> }
) => Promise<{
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly ok: boolean;
  readonly status: number;
}>;

/**
 * `GET /repos/{repo}/tarball/{sha}`, which redirects to a short-lived
 * download URL; `fetch` follows it and drops the authorization header on
 * the way, which the signed URL does not need.
 */
export const downloadArchive = async (input: {
  readonly fetchImpl?: ArchiveFetch;
  readonly repository: string;
  readonly sha: string;
  readonly token: string;
}): Promise<Uint8Array> => {
  const { fetchImpl = fetch, repository, sha, token } = input;
  const response = await fetchImpl(
    `${GITHUB_API}/repos/${repository}/tarball/${sha}`,
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
      `GitHub answered ${response.status} downloading ${repository}.`
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ARCHIVE_BYTES) {
    throw new Error(`${repository} is larger than the archive limit.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`${repository} is larger than the archive limit.`);
  }
  return bytes;
};
