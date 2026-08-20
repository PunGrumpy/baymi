import { rmSync, writeFileSync } from "node:fs";

import { chromium } from "playwright-core";
import type { Page } from "playwright-core";

/**
 * Runs a browser module in headless Chromium and hands back the page.
 *
 * @remarks
 * Both generators here need the same thing: bundle a module, serve it over
 * `http://localhost`, open it, drive it, tear everything down. Only the module,
 * the port and the Chromium flags differ.
 *
 * `localhost` rather than a `file://` URL or `about:blank` is load-bearing.
 * WebGPU is gated on a secure context, and `navigator.gpu` is simply absent
 * anywhere else, which looks exactly like a browser that does not support it.
 */

/** Where Chromium lives. `BANNER_BROWSER` overrides the Playwright install. */
const findBrowser = () => {
  const configured = process.env.BANNER_BROWSER;
  if (configured) {
    return configured;
  }
  const glob = new Bun.Glob("chromium-*/chrome-linux*/chrome");
  const [found] = [
    ...glob.scanSync({
      absolute: true,
      cwd: `${process.env.HOME ?? ""}/.cache/ms-playwright`,
    }),
  ];
  if (!found) {
    throw new Error(
      "no Chromium found; run `bunx playwright install chromium` or set BANNER_BROWSER"
    );
  }
  return found;
};

/**
 * Bundles `source` as a browser module.
 *
 * @remarks
 * The scratch file goes next to this one rather than in `tmpdir()`, because
 * module resolution walks up from the entry file and these imports live in this
 * package's `node_modules`.
 */
const bundle = async (source: string, name: string) => {
  const entry = new URL(`.${name}-entry.ts`, import.meta.url);
  writeFileSync(entry, source);
  try {
    const built = await Bun.build({
      entrypoints: [entry.pathname],
      target: "browser",
    });
    if (!built.success) {
      throw new AggregateError(built.logs, "failed to bundle the render page");
    }
    return await built.outputs[0].text();
  } finally {
    rmSync(entry, { force: true });
  }
};

interface RenderPageOptions {
  /** Browser module source. Imports resolve against `brand/`. */
  source: string;
  /** Used to name the scratch entry file, so parallel runs cannot collide. */
  name: string;
  port: number;
  /** Extra Chromium flags. Sandbox and shm flags are always applied. */
  args: string[];
  /** Global the module defines, awaited before `use` runs. */
  ready: string;
}

export const withRenderPage = async <T>(
  options: RenderPageOptions,
  use: (page: Page) => Promise<T>
): Promise<T> => {
  const script = await bundle(options.source, options.name);

  const server = Bun.serve({
    fetch(request) {
      const route = new URL(request.url).pathname;
      if (route === "/bundle.js") {
        return new Response(script, {
          headers: { "content-type": "text/javascript" },
        });
      }
      if (route === "/") {
        return new Response(
          '<!doctype html><meta charset="utf-8"><script type="module" src="/bundle.js"></script>',
          { headers: { "content-type": "text/html" } }
        );
      }
      return new Response("", { status: 204 });
    },
    port: options.port,
  });

  const browser = await chromium.launch({
    args: [...options.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath: findBrowser(),
  });

  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => {
      process.stderr.write(`[page] ${error.message}\n`);
    });
    await page.goto(`http://localhost:${options.port}/`);
    await page.waitForFunction((global) => global in window, options.ready);
    return await use(page);
  } finally {
    await browser.close();
    server.stop();
  }
};
