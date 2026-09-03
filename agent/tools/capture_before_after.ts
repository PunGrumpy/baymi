import { put } from "@vercel/blob";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import {
  CAPTURE_PREFIX,
  captureCommand,
  captureMarkdown,
  parseSavedFrames,
  previewCommand,
  previewFramePath,
  validateCaptureUrl,
} from "#lib/capture";
import type { CaptureViewport } from "#lib/capture";
import { isAutonomous } from "#lib/trust";

const CAPTURE_DIRECTORY = "/tmp/baymi-capture";

const UNSAFE_ARGUMENT =
  "That URL or selector carries characters this refuses to put on a command line.";

/** The two sandbox capabilities a capture needs: run a command, read a file. */
interface CaptureSandbox {
  readonly readBinaryFile: (options: {
    readonly path: string;
  }) => PromiseLike<Uint8Array | null>;
  readonly run: (options: { readonly command: string }) => PromiseLike<{
    readonly exitCode: number;
    readonly stderr?: unknown;
    readonly stdout?: unknown;
  }>;
}

/** Where each frame landed in the sandbox. */
interface Frames {
  readonly after: string;
  readonly before?: string;
}

interface Refusal {
  readonly error: string;
}

const failure = (
  what: string,
  result: { exitCode: number; stderr?: unknown; stdout?: unknown }
): Refusal => ({
  error: `${what} (exit ${result.exitCode}): ${String(result.stderr ?? result.stdout ?? "").slice(0, 400)}`,
});

/**
 * Captures a pair through the CLI, or one frame through the browser when
 * there is no before, and says where the files are.
 */
const capture = async (
  sandbox: CaptureSandbox,
  input: {
    readonly after: string;
    readonly before?: string;
    readonly fullPage?: boolean;
    readonly selector?: string;
    readonly viewport?: CaptureViewport;
  }
): Promise<Frames | Refusal> => {
  const shared = { ...input, directory: CAPTURE_DIRECTORY };
  if (input.before === undefined) {
    const command = previewCommand(shared);
    if (!command) {
      return { error: UNSAFE_ARGUMENT };
    }
    const result = await sandbox.run({ command });
    if (result.exitCode !== 0) {
      return failure("The capture produced no frame", result);
    }
    return { after: previewFramePath(CAPTURE_DIRECTORY) };
  }
  const command = captureCommand({ ...shared, before: input.before });
  if (!command) {
    return { error: UNSAFE_ARGUMENT };
  }
  const result = await sandbox.run({ command });
  const frames = parseSavedFrames(String(result.stdout ?? ""));
  return frames ?? failure("The capture produced no pair", result);
};

/** One frame, uploaded to the public store and addressable by URL. */
const upload = async (
  sandbox: CaptureSandbox,
  path: string,
  key: string
): Promise<string> => {
  const bytes = await sandbox.readBinaryFile({ path });
  if (!bytes) {
    throw new Error(`The capture wrote no readable file at ${path}.`);
  }
  const blob = await put(key, Buffer.from(bytes), {
    access: "public",
    addRandomSuffix: true,
    contentType: "image/png",
  });
  return blob.url;
};

/**
 * Captures a page before and after a change and returns the comparison as
 * markdown, hosted on this agent's own Blob store.
 *
 * @remarks
 * The whole capture happens here rather than in prose: the frames are shot
 * in the sandbox, read back out of it, uploaded, and rendered as the marked
 * block a pull request body carries. The model gets one call and one block
 * to paste, with nothing to reassemble by hand.
 *
 * A page that did not exist before the change has no before. Leaving it out
 * captures the after alone and renders it as a preview, rather than a pair
 * whose two sides show the same thing or a table with a hole in it.
 *
 * Hosting is deliberately ours. The CLI's own `--markdown` uploads both frames
 * to a public paste host, and `gh --attach` refuses the App's installation
 * token (`docs/notes.md`); a screenshot of an unreleased page belongs on the
 * store this agent already owns, under its own reserved prefix.
 *
 * Every URL is checked against `validateCaptureUrl` before anything runs. A
 * capture reaches its target from inside the sandbox, whose egress is open,
 * and publishes what it finds at a public URL, so the target is an allow-list
 * rather than model discretion.
 *
 * Withheld from unattended turns, like every other capability that writes:
 * a triage session runs on text a stranger wrote, and nothing downstream of
 * that gets to publish an image.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (isAutonomous(ctx.session.auth.current)) {
        return null;
      }
      return {
        capture_before_after: defineTool({
          description:
            "Screenshot a page before and after a change and return the comparison as a marked markdown block, hosted as public images, ready to paste into a pull request body. Before is usually the deployed production page and after is the branch's preview or a dev server you started. Leave before out for a page that did not exist before the change, and the after is rendered alone as a preview. Only *.vercel.app deployments and localhost are capturable.",
          async execute(
            { after, before, fullPage, selector, viewport },
            toolCtx
          ) {
            const urls = before === undefined ? [after] : [before, after];
            for (const url of urls) {
              const refusal = validateCaptureUrl(url);
              if (refusal) {
                return { error: refusal, success: false };
              }
            }
            const sandbox = await toolCtx.getSandbox();
            const frames = await capture(sandbox, {
              after,
              before,
              fullPage,
              selector,
              viewport,
            });
            if ("error" in frames) {
              return { error: frames.error, success: false };
            }
            const stem = `${CAPTURE_PREFIX}${Date.now()}`;
            const [afterUrl, beforeUrl] = await Promise.all([
              upload(sandbox, frames.after, `${stem}-after.png`),
              frames.before === undefined
                ? undefined
                : upload(sandbox, frames.before, `${stem}-before.png`),
            ]);
            return {
              afterUrl,
              beforeUrl,
              markdown: captureMarkdown({ afterUrl, beforeUrl, fullPage }),
              success: true,
            };
          },
          inputSchema: z.object({
            after: z
              .string()
              .describe(
                "The changed page: the branch's Vercel preview, or a dev server you started in the sandbox"
              ),
            before: z
              .string()
              .optional()
              .describe(
                "The page as it is now, usually the deployed production URL. Omit when the page is new and there is nothing to compare against"
              ),
            fullPage: z
              .boolean()
              .optional()
              .describe(
                "Capture the whole scrollable page rather than the first viewport. Use when the change sits below the fold or the page's length is the point"
              ),
            selector: z
              .string()
              .optional()
              .describe(
                "CSS selector to scroll into view before capturing, e.g. .hero"
              ),
            viewport: z
              .enum(["desktop", "mobile", "tablet"])
              .optional()
              .describe("Viewport to capture at. Defaults to desktop"),
          }),
          outputSchema: z.object({
            afterUrl: z.string().optional(),
            beforeUrl: z.string().optional(),
            error: z.string().optional(),
            markdown: z.string().optional(),
            success: z.boolean(),
          }),
        }),
      };
    },
  },
});
