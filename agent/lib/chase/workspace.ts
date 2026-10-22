import { Buffer } from "node:buffer";

/**
 * The fixed commands the chase's tools run in the sandbox, and the parsers
 * for what they print.
 *
 * @remarks
 * The model runs its own commands through `bash`. These are the ones the
 * tools run on its behalf, and they are written here rather than taken from
 * the model: unpacking the repository, recording the baseline, measuring
 * what changed, and listing the files to push.
 */

/** Where the repository is unpacked. */
export const REPO_DIR = "/workspace/repo";

/** Where the downloaded archive is written before it is unpacked. */
export const ARCHIVE_PATH = "/tmp/baymi-source.tar.gz";

/**
 * A fix that touches more files than this is not the smallest change that
 * makes one failing check pass, and is reported rather than pushed.
 */
export const MAX_CHANGED_FILES = 50;

/**
 * Paths never pushed, whatever `.gitignore` says. A project that does not
 * ignore its installed dependencies would otherwise push all of them.
 *
 * @remarks
 * They go in the checkout's own `.git/info/exclude`, which is never pushed,
 * rather than in an `:(exclude)` pathspec: once the install has created
 * `node_modules`, a pathspec naming a path `.gitignore` already ignores
 * makes `git add` exit 1, and every command chained after it printed nothing
 * (`docs/notes.md`).
 */
const EXCLUDED = ["node_modules/"] as const;

/** Unpacks the archive GitHub serves, whose files sit under one top folder. */
export const UNPACK_COMMAND = [
  `rm -rf ${REPO_DIR}`,
  `mkdir -p ${REPO_DIR}`,
  `tar -xzf ${ARCHIVE_PATH} --strip-components=1 -C ${REPO_DIR}`,
  `rm -f ${ARCHIVE_PATH}`,
].join(" && ");

/**
 * Commits the unpacked tree locally, so every later change is a diff against
 * the commit the task names. The archive carries no history.
 */
export const BASELINE_COMMAND = [
  `cd ${REPO_DIR}`,
  "git init -q",
  "mkdir -p .git/info",
  `printf '%s\\n' ${EXCLUDED.join(" ")} >> .git/info/exclude`,
  "git add -A",
  "git -c user.name=baymi -c user.email=baymi@users.noreply.github.com commit -q --no-verify -m baseline",
].join(" && ");

/** Stages every change outside the excluded paths. */
const STAGE = `cd ${REPO_DIR} && git add -A`;

/** A digest of the staged change; equal digests mean the same change. */
export const DIGEST_COMMAND = `${STAGE} && git diff --cached --binary HEAD | sha256sum | cut -d' ' -f1`;

/**
 * Pipes a NUL-separated listing through base64, so it survives a sandbox
 * whose command output does not carry NUL bytes (`docs/notes.md`). The
 * runtime decodes it with {@link decodeListing}.
 */
const ENCODE = "base64 | tr -d '\\n'";

/** The changed paths, NUL-separated and base64-encoded, renames split into delete and add. */
export const CHANGES_COMMAND = `${STAGE} && git diff --cached --name-status -z --no-renames HEAD | ${ENCODE}`;

/** The staged entries with their modes, NUL-separated and base64-encoded. */
export const MODES_COMMAND = `${STAGE} && git ls-files -s -z | ${ENCODE}`;

/** The NUL-separated listing a command above printed as base64. */
export const decodeListing = (stdout: string): string =>
  Buffer.from(stdout.trim(), "base64").toString("utf-8");

/** The root's file names, one per line, to find the lockfile. */
export const ROOT_FILES_COMMAND = `ls -1A ${REPO_DIR}`;

/**
 * Reads `git ls-files -s -z`: `<mode> <sha> <stage>\t<path>` per entry.
 * Only the executable bit matters to the commit, so any mode other than
 * `100755` is a regular file.
 */
export const parseModes = (
  output: string
): ReadonlyMap<string, "100644" | "100755"> => {
  const modes = new Map<string, "100644" | "100755">();
  for (const entry of output.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const mode = entry.slice(0, entry.indexOf(" "));
    modes.set(entry.slice(tab + 1), mode === "100755" ? "100755" : "100644");
  }
  return modes;
};

/**
 * Whether a path the model's change touches is safe to read back and push:
 * relative, inside the repository, and not under an excluded folder.
 */
export const isPushablePath = (path: string): boolean =>
  path !== "" &&
  !path.startsWith("/") &&
  !path
    .split("/")
    .some((segment) => segment === ".." || segment === "node_modules");
