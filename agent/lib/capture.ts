/**
 * Blob path prefix for before/after screenshots.
 *
 * @remarks
 * The Blob store is public, so anything written here is readable by URL. That
 * is the point: a pull request body needs an image URL a reviewer's browser
 * can fetch. It also means a capture is a publication, which is why the hosts
 * below are an allow-list rather than a filter.
 */
export const CAPTURE_PREFIX = "captures/";

/**
 * Hosts a capture may be taken from.
 *
 * @remarks
 * Every repository this agent follows deploys to Vercel, so production, a
 * pull request's preview, and a dev server the agent started itself are the
 * three things it ever needs to look at. A capture reaches a URL from inside
 * the sandbox, whose egress is open, and publishes what it finds to a public
 * store: without this list, "screenshot this page for me" is a way to read an
 * internal address and hand back the picture.
 *
 * A custom domain belongs here the day one is used; the list is short because
 * it is meant to be read, not because the set is theoretically complete.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

const ALLOWED_HOST_SUFFIX = ".vercel.app";

/** The refusal reason, or null when this URL may be captured. */
export const validateCaptureUrl = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not a URL.`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `${parsed.protocol} is not a scheme this captures from.`;
  }
  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host) || host.endsWith(ALLOWED_HOST_SUFFIX)) {
    return null;
  }
  return `${host} is not a host this agent captures from. Allowed: a *.vercel.app deployment, or a dev server on localhost.`;
};

/** Characters that end the argument and start something else in a shell. */
const SHELL_UNSAFE = /[^\w.:/?=&%#@,+-]/u;

/**
 * The command that captures both frames into `directory`.
 *
 * @remarks
 * `--markdown` is deliberately absent. It would upload both images to 0x0.st,
 * a public paste host, which is the CLI's default destination and is not a
 * place this agent's screenshots belong. Capture writes files; hosting is the
 * tool's own job, on the store it already owns.
 *
 * Every argument is checked against a conservative character set rather than
 * quoted, because the URLs reach a shell and a URL is model input.
 */
export const captureCommand = (input: {
  readonly after: string;
  readonly before: string;
  readonly directory: string;
  readonly selector?: string;
  readonly viewport?: "desktop" | "mobile" | "tablet";
}): string | null => {
  const parts = [input.before, input.after, input.directory, input.selector];
  for (const part of parts) {
    if (part !== undefined && SHELL_UNSAFE.test(part)) {
      return null;
    }
  }
  const selector = input.selector ? ` '${input.selector}'` : "";
  const viewport =
    input.viewport && input.viewport !== "desktop"
      ? ` --${input.viewport}`
      : "";
  return `rm -rf ${input.directory} && mkdir -p ${input.directory} && before-and-after ${input.before} ${input.after}${selector} --output ${input.directory}${viewport}`;
};

/** Where the CLI said it wrote each frame. */
export interface SavedFrames {
  readonly after: string;
  readonly before: string;
}

const SAVED_LINE = /^Saved:\s*(?<path>\S.*)$/gmu;

/**
 * The two file paths the CLI reports on stdout, in the order it captured them.
 *
 * @remarks
 * The filenames are derived from the page title and a timestamp, so they
 * cannot be predicted; the `Saved:` lines are the contract. Two lines are
 * expected, before first. Anything else means the capture did not produce a
 * pair, and a report built on one frame is worse than no report.
 */
export const parseSavedFrames = (stdout: string): SavedFrames | null => {
  const paths = [...stdout.matchAll(SAVED_LINE)]
    .map((match) => match.groups?.path?.trim())
    .filter((path): path is string => path !== undefined && path.length > 0);
  const [before, after] = paths;
  if (paths.length !== 2 || !(before && after)) {
    return null;
  }
  return { after, before };
};

/** The comparison table, ready to paste into a pull request body. */
export const captureMarkdown = (input: {
  readonly afterUrl: string;
  readonly beforeUrl: string;
}): string =>
  [
    "| Before | After |",
    "| --- | --- |",
    `| ![before](${input.beforeUrl}) | ![after](${input.afterUrl}) |`,
  ].join("\n");
