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
 * Reads `git ls-files -s -z`: `<mode> <sha> <stage>\t<path>` per entry, with
 * the mode as git prints it. {@link modeProblems} decides what may be pushed.
 */
export const parseModes = (output: string): ReadonlyMap<string, string> => {
  const modes = new Map<string, string>();
  for (const entry of output.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    modes.set(entry.slice(tab + 1), entry.slice(0, entry.indexOf(" ")));
  }
  return modes;
};

const EXECUTABLE = "100755";
const REGULAR = "100644";

const SPECIAL_MODES = new Map([
  ["040000", "directory"],
  ["120000", "symlink"],
  ["160000", "submodule"],
]);

/**
 * Why each changed file cannot be pushed as the regular file the Git Data API
 * would make of it.
 *
 * @remarks
 * Only `100644` and `100755` are regular files. A symlink is staged as mode
 * `120000` with the link's text as its content, but the runtime reads the
 * path back through the sandbox, which follows the link and sends the
 * target's bytes as a regular file; a submodule has no bytes to send. Either
 * would put on the branch something other than what the checks passed on. A
 * deleted path has no entry in the index and is not checked: removing a link
 * is a plain deletion. A changed path with no entry at all is refused rather
 * than assumed regular.
 */
export const modeProblems = (
  changes: readonly { readonly deleted: boolean; readonly path: string }[],
  modes: ReadonlyMap<string, string>
): readonly string[] =>
  changes.flatMap((change) => {
    if (change.deleted) {
      return [];
    }
    const mode = modes.get(change.path);
    if (mode === EXECUTABLE || mode === REGULAR) {
      return [];
    }
    if (mode === undefined) {
      return [
        `${change.path} has no entry in the index, so its mode is unknown.`,
      ];
    }
    return [
      `${change.path} is a ${SPECIAL_MODES.get(mode) ?? "special file"} (mode ${mode}); a chase pushes regular files only.`,
    ];
  });

/** The mode a regular, verified file is committed with. */
export const commitMode = (
  modes: ReadonlyMap<string, string>,
  path: string
): "100644" | "100755" =>
  modes.get(path) === EXECUTABLE ? EXECUTABLE : REGULAR;

/** Where CI lives: a chase fixes the code CI checks, never CI itself. */
const WORKFLOWS_DIRECTORY = ".github/workflows";

/**
 * Why a path the model's change touches cannot be pushed, or `null` when it
 * can: it must be relative and inside the repository, not under an excluded
 * folder or `.git`, and not under `.github/workflows`.
 *
 * @remarks
 * The workflows folder is refused whatever the change is, a deletion
 * included. The App may lack the `workflows` permission, which GitHub
 * demands for any commit that touches it, and a fix that changes the
 * pipeline judging it is not a fix the checks can vouch for.
 */
export const pathProblem = (path: string): string | null => {
  const lower = path.toLowerCase();
  if (
    lower === WORKFLOWS_DIRECTORY ||
    lower.startsWith(`${WORKFLOWS_DIRECTORY}/`)
  ) {
    return `${path} is under ${WORKFLOWS_DIRECTORY}, which a chase never changes.`;
  }
  const outside =
    path === "" ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (segment) =>
          segment === ".." || segment === ".git" || segment === "node_modules"
      );
  return outside ? `${path} may not be pushed.` : null;
};

/** Whether a path the model's change touches is safe to read back and push. */
export const isPushablePath = (path: string): boolean =>
  pathProblem(path) === null;
