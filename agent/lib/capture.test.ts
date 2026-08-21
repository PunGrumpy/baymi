import { describe, expect, it } from "vitest";

import {
  captureCommand,
  captureMarkdown,
  parseSavedFrames,
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

  it("builds nothing from an argument that could leave the argument", () => {
    // The URLs are model input and they reach a shell.
    expect(
      captureCommand({ ...base, after: "http://localhost:3000; rm -rf /" })
    ).toBeNull();
    expect(captureCommand({ ...base, selector: "$(whoami)" })).toBeNull();
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
  it("renders the pair as a table a pull request body can carry", () => {
    expect(
      captureMarkdown({
        afterUrl: "https://blob.test/after.png",
        beforeUrl: "https://blob.test/before.png",
      })
    ).toBe(
      "| Before | After |\n| --- | --- |\n| ![before](https://blob.test/before.png) | ![after](https://blob.test/after.png) |"
    );
  });
});
