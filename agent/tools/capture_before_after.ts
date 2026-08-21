import { put } from "@vercel/blob";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import {
  CAPTURE_PREFIX,
  captureCommand,
  captureMarkdown,
  parseSavedFrames,
  validateCaptureUrl,
} from "#lib/capture";
import { isAutonomous } from "#lib/trust";

const CAPTURE_DIRECTORY = "/tmp/baymi-capture";

/** The one sandbox capability an upload needs: the bytes of one file. */
interface FrameReader {
  readonly readBinaryFile: (options: {
    readonly path: string;
  }) => PromiseLike<Uint8Array | null>;
}

/** One frame, uploaded to the public store and addressable by URL. */
const upload = async (
  sandbox: FrameReader,
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
 * The whole capture happens here rather than in prose: the CLI runs in the
 * sandbox, the two frames are read back out of it, uploaded, and rendered as
 * the table a pull request body carries. The model gets one call and one
 * block to paste, with nothing to reassemble by hand.
 *
 * Hosting is deliberately ours. The CLI's own `--markdown` uploads both frames
 * to a public paste host; a screenshot of an unreleased page belongs on the
 * store this agent already owns, under its own reserved prefix.
 *
 * Both URLs are checked against `validateCaptureUrl` before anything runs. A
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
            "Screenshot two URLs and return a before/after markdown table, hosted as public images, ready to paste into a pull request body. Before is usually the deployed production page and after is the branch's preview or a dev server you started. Only *.vercel.app deployments and localhost are capturable.",
          async execute({ after, before, selector, viewport }, toolCtx) {
            for (const url of [before, after]) {
              const refusal = validateCaptureUrl(url);
              if (refusal) {
                return { error: refusal, success: false };
              }
            }
            const command = captureCommand({
              after,
              before,
              directory: CAPTURE_DIRECTORY,
              selector,
              viewport,
            });
            if (!command) {
              return {
                error:
                  "That URL or selector carries characters this refuses to put on a command line.",
                success: false,
              };
            }
            const sandbox = await toolCtx.getSandbox();
            const capture = await sandbox.run({ command });
            const frames = parseSavedFrames(String(capture.stdout ?? ""));
            if (!frames) {
              return {
                error: `The capture produced no pair (exit ${capture.exitCode}): ${String(capture.stderr ?? capture.stdout ?? "").slice(0, 400)}`,
                success: false,
              };
            }
            const stem = `${CAPTURE_PREFIX}${Date.now()}`;
            const [beforeUrl, afterUrl] = await Promise.all([
              upload(sandbox, frames.before, `${stem}-before.png`),
              upload(sandbox, frames.after, `${stem}-after.png`),
            ]);
            return {
              afterUrl,
              beforeUrl,
              markdown: captureMarkdown({ afterUrl, beforeUrl }),
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
              .describe(
                "The page as it is now, usually the deployed production URL"
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
