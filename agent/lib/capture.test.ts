import { describe, expect, it } from "vitest";

import {
  CAPTURE_MARKER_END,
  CAPTURE_MARKER_START,
  captureCommand,
  captureMarkdown,
  parseSavedFrames,
  previewCommand,
  previewFramePath,
  validateCaptureUrl,
} from "#lib/capture";

describe(validateCaptureUrl, () => {
  it("allows a deployment and a dev server", () => {
    expect(validateCaptureUrl("https://logixlysia.vercel.app")).toBeNull();
    expect(
      validateCaptureUrl("https://docker-doctor-git-fix-abc123.vercel.app/docs")
    ).toBeNull();
    expect(validateCaptureUrl("http://localhost:3000/docs")).toBeNull();
  });

  it("refuses every other host", () => {
    // A capture reaches the URL from inside the sandbox and publishes what it
    // finds to a public store, so an open target is a way to read an internal
    // address and get the picture back.
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/admin",
      "https://example.com",
      "https://vercel.app.attacker.test/",
    ]) {
      expect(validateCaptureUrl(url)).toContain("not a host");
    }
  });

  it("refuses a scheme that is not http", () => {
    expect(validateCaptureUrl("file:///etc/passwd")).toContain("not a scheme");
    expect(validateCaptureUrl("not a url at all")).toContain("not a URL");
  });
});

describe(captureCommand, () => {
  const base = {
    after: "http://localhost:3000",
    before: "https://logixlysia.vercel.app",
    directory: "/tmp/capture",
  };

  it("captures into the directory without uploading anywhere", () => {
    const command = captureCommand(base) ?? "";
    expect(command).toContain("--output /tmp/capture");
    // --markdown would send both frames to 0x0.st, a public paste host.
    expect(command).not.toContain("--markdown");
  });

  it("clears the directory first, so a stale pair cannot be read back", () => {
    expect(captureCommand(base) ?? "").toContain("rm -rf /tmp/capture");
  });

  it("passes a viewport only when it is not the default", () => {
    expect(captureCommand({ ...base, viewport: "mobile" }) ?? "").toContain(
      "--mobile"
    );
    expect(
      captureCommand({ ...base, viewport: "desktop" }) ?? ""
    ).not.toContain("--desktop");
  });

  it("captures the whole page only when asked", () => {
    expect(captureCommand({ ...base, fullPage: true }) ?? "").toContain(
      "--full"
    );
    expect(captureCommand(base) ?? "").not.toContain("--full");
  });

  it("builds nothing from an argument that could leave the argument", () => {
    // The URLs are model input and they reach a shell.
    expect(
      captureCommand({ ...base, after: "http://localhost:3000; rm -rf /" })
    ).toBeNull();
    expect(captureCommand({ ...base, selector: "$(whoami)" })).toBeNull();
  });
});

describe(previewCommand, () => {
  const base = {
    after: "http://localhost:3000/new",
    directory: "/tmp/capture",
  };

  it("drives the browser through one frame at the CLI's desktop size", () => {
    const command = previewCommand(base) ?? "";
    expect(command).toContain("rm -rf /tmp/capture");
    expect(command).toContain("agent-browser set viewport 1280 800");
    expect(command).toContain("agent-browser open http://localhost:3000/new");
    expect(command).toContain(
      `agent-browser screenshot ${previewFramePath("/tmp/capture")}`
    );
  });

  it("sizes the other presets the way the CLI does", () => {
    expect(previewCommand({ ...base, viewport: "mobile" }) ?? "").toContain(
      "set viewport 375 812"
    );
    expect(previewCommand({ ...base, viewport: "tablet" }) ?? "").toContain(
      "set viewport 768 1024"
    );
  });

  it("scrolls a selector into view before shooting, and only then", () => {
    const command = previewCommand({ ...base, selector: ".hero" }) ?? "";
    expect(command).toContain("scrollintoview '.hero'");
    expect(command.indexOf("scrollintoview")).toBeLessThan(
      command.indexOf("screenshot")
    );
    expect(previewCommand(base) ?? "").not.toContain("scrollintoview");
  });

  it("captures the whole page only when asked", () => {
    expect(previewCommand({ ...base, fullPage: true }) ?? "").toContain(
      "screenshot --full"
    );
    expect(previewCommand(base) ?? "").not.toContain("--full");
  });

  it("closes the browser and reports the capture's own status", () => {
    const command = previewCommand(base) ?? "";
    // A close that fails after a good capture must not read as a failed
    // capture, and a failed capture must not be hidden by a clean close.
    expect(command).toMatch(
      /status=\$\?; agent-browser close.*exit \$status$/u
    );
  });

  it("builds nothing from an argument that could leave the argument", () => {
    expect(
      previewCommand({ ...base, after: "http://localhost:3000; rm -rf /" })
    ).toBeNull();
    expect(previewCommand({ ...base, selector: "'; whoami; '" })).toBeNull();
  });
});

describe(parseSavedFrames, () => {
  it("reads the two paths the CLI reports, before first", () => {
    const stdout = [
      "Capturing before: https://logixlysia.vercel.app",
      "Capturing after:  http://localhost:3000",
      "",
      "Saved: /tmp/capture/docs-home-before.png",
      "Saved: /tmp/capture/docs-home-after.png",
    ].join("\n");
    expect(parseSavedFrames(stdout)).toStrictEqual({
      after: "/tmp/capture/docs-home-after.png",
      before: "/tmp/capture/docs-home-before.png",
    });
  });

  it("has no frames when the capture did not produce a pair", () => {
    // One frame is worse than none: a table with an empty side reads as a
    // rendering bug rather than as a failed capture.
    expect(parseSavedFrames("Saved: /tmp/only-one.png")).toBeNull();
    expect(parseSavedFrames("Error: navigation timed out")).toBeNull();
    expect(parseSavedFrames("")).toBeNull();
  });
});

describe(captureMarkdown, () => {
  const urls = {
    afterUrl: "https://blob.test/after.png",
    beforeUrl: "https://blob.test/before.png",
  };

  it("renders the pair as a table a pull request body can carry", () => {
    expect(captureMarkdown(urls)).toBe(
      [
        CAPTURE_MARKER_START,
        "| Before | After |",
        "| --- | --- |",
        "| ![before](https://blob.test/before.png) | ![after](https://blob.test/after.png) |",
        CAPTURE_MARKER_END,
      ].join("\n")
    );
  });

  it("fences every block with the markers an editor can find again", () => {
    for (const block of [
      captureMarkdown(urls),
      captureMarkdown({ ...urls, fullPage: true }),
      captureMarkdown({ afterUrl: urls.afterUrl }),
    ]) {
      expect(block.startsWith(CAPTURE_MARKER_START)).toBeTruthy();
      expect(block.endsWith(CAPTURE_MARKER_END)).toBeTruthy();
    }
  });

  it("pins full-page frames to the top of their cells", () => {
    // Two full pages are rarely the same height, and a markdown table would
    // centre the shorter one, so the tops no longer line up.
    const block = captureMarkdown({ ...urls, fullPage: true });
    expect(block).toContain('<td valign="top"><img alt="before"');
    expect(block).toContain('<td valign="top"><img alt="after"');
    expect(block).not.toContain("| Before | After |");
  });

  it("renders a lone frame as a preview, not as a pair with a hole", () => {
    const block = captureMarkdown({ afterUrl: urls.afterUrl });
    expect(block).toContain("| Preview |");
    expect(block).toContain("![preview](https://blob.test/after.png)");
    expect(block).not.toContain("Before");
  });
});
