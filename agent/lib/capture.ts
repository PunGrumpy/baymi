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
 * The comments that fence the comparison inside a pull request body.
 *
 * @remarks
 * The same markers the upstream `before-and-after` skill uses, so an editor
 * that knows the convention finds this agent's block and replaces the block
 * rather than the prose around it. Nothing in this agent edits a body yet: no
 * pull request update tool is mounted. The markers cost nothing now and mean
 * the day one is, a second capture replaces the first instead of stacking.
 */
export const CAPTURE_MARKER_START = "<!-- before-and-after:start -->";
export const CAPTURE_MARKER_END = "<!-- before-and-after:end -->";

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

export type CaptureViewport = "desktop" | "mobile" | "tablet";

/**
 * The CLI's viewport presets, repeated so a single frame is sized the way a
 * pair is.
 *
 * @remarks
 * A pair goes through the `before-and-after` CLI and takes its preset by
 * flag; a lone frame drives `agent-browser` directly and has to state the
 * size. These are the CLI's numbers, so a preview of a page and a later
 * comparison of the same page line up.
 */
const VIEWPORTS = {
  desktop: { height: 800, width: 1280 },
  mobile: { height: 812, width: 375 },
  tablet: { height: 1024, width: 768 },
} as const satisfies Record<
  CaptureViewport,
  { readonly height: number; readonly width: number }
>;

/** Characters that end the argument and start something else in a shell. */
const SHELL_UNSAFE = /[^\w.:/?=&%#@,+-]/u;

/**
 * Whether every given argument stays an argument on a command line.
 *
 * @remarks
 * Checked against a conservative character set rather than quoted, because
 * the URLs reach a shell and a URL is model input.
 */
const shellSafe = (parts: readonly (string | undefined)[]): boolean =>
  parts.every((part) => part === undefined || !SHELL_UNSAFE.test(part));

/** What one frame is captured from, and how. */
export interface FrameInput {
  readonly after: string;
  readonly directory: string;
  /** Capture the whole scrollable page rather than the first viewport. */
  readonly fullPage?: boolean;
  readonly selector?: string;
  readonly viewport?: CaptureViewport;
}

/** A pair: the same, with the page as it was. */
export interface PairInput extends FrameInput {
  readonly before: string;
}

/**
 * The command that captures both frames into `directory`.
 *
 * @remarks
 * `--markdown` is deliberately absent. It would upload both images to 0x0.st,
 * a public paste host, which is the CLI's default destination and is not a
 * place this agent's screenshots belong. Capture writes files; hosting is the
 * tool's own job, on the store it already owns.
 */
export const captureCommand = (input: PairInput): string | null => {
  if (
    !shellSafe([input.before, input.after, input.directory, input.selector])
  ) {
    return null;
  }
  const selector = input.selector ? ` '${input.selector}'` : "";
  const viewport =
    input.viewport && input.viewport !== "desktop"
      ? ` --${input.viewport}`
      : "";
  const full = input.fullPage ? " --full" : "";
  return `rm -rf ${input.directory} && mkdir -p ${input.directory} && before-and-after ${input.before} ${input.after}${selector} --output ${input.directory}${viewport}${full}`;
};

/**
 * Where a single-frame capture writes.
 *
 * @remarks
 * Decided here rather than read back: with one frame there is no pair to
 * order, so the path can be fixed and nothing on stdout needs parsing.
 */
export const previewFramePath = (directory: string): string =>
  `${directory}/after.png`;

/**
 * The command that captures one frame, for a page that has no before.
 *
 * @remarks
 * The CLI insists on two URLs, so a lone frame runs `agent-browser` the same
 * way the CLI does internally: size the viewport, open the page, let fonts
 * and scripts settle, scroll the selector into view if there is one, and
 * screenshot. The browser is closed whatever happened, and the capture's own
 * exit status is what comes back: a close that fails after a good capture
 * must not turn into a failed capture.
 */
export const previewCommand = (input: FrameInput): string | null => {
  if (!shellSafe([input.after, input.directory, input.selector])) {
    return null;
  }
  const { height, width } = VIEWPORTS[input.viewport ?? "desktop"];
  const full = input.fullPage ? " --full" : "";
  const steps = [
    `rm -rf ${input.directory}`,
    `mkdir -p ${input.directory}`,
    `agent-browser set viewport ${width} ${height}`,
    `agent-browser open ${input.after}`,
    "agent-browser wait 500",
  ];
  if (input.selector) {
    steps.push(
      `agent-browser scrollintoview '${input.selector}'`,
      "agent-browser wait 200"
    );
  }
  steps.push(
    `agent-browser screenshot${full} ${previewFramePath(input.directory)}`
  );
  return `(${steps.join(" && ")}); status=$?; agent-browser close >/dev/null 2>&1; exit $status`;
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

/** The hosted frames a comparison is rendered from. */
export interface CaptureUrls {
  readonly afterUrl: string;
  /** Absent for a page that did not exist before the change. */
  readonly beforeUrl?: string;
  readonly fullPage?: boolean;
}

/**
 * The rows of the comparison, in the shape GitHub renders best for them.
 *
 * @remarks
 * A markdown table centres a shorter image vertically in its cell, which for
 * two full-page frames of different length puts the top edges at different
 * heights and turns a comparison into spot-the-offset. GitHub's sanitizer
 * keeps `valign` on a table cell, so full-page pairs go out as HTML with both
 * frames pinned to the top. Viewport frames are the same size by
 * construction and keep the markdown table, which reads as a table when the
 * body is viewed raw.
 */
const comparisonRows = (input: CaptureUrls): readonly string[] => {
  if (input.beforeUrl === undefined) {
    return ["| Preview |", "| --- |", `| ![preview](${input.afterUrl}) |`];
  }
  if (input.fullPage) {
    return [
      "<table>",
      "  <tr><th>Before</th><th>After</th></tr>",
      `  <tr><td valign="top"><img alt="before" src="${input.beforeUrl}"></td><td valign="top"><img alt="after" src="${input.afterUrl}"></td></tr>`,
      "</table>",
    ];
  }
  return [
    "| Before | After |",
    "| --- | --- |",
    `| ![before](${input.beforeUrl}) | ![after](${input.afterUrl}) |`,
  ];
};

/** The comparison as a marked block, ready to paste into a pull request body. */
export const captureMarkdown = (input: CaptureUrls): string =>
  [CAPTURE_MARKER_START, ...comparisonRows(input), CAPTURE_MARKER_END].join(
    "\n"
  );
