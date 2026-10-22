import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

const DAYS_MS = 24 * 60 * 60 * 1000;

/**
 * The only hosts the sandbox can reach: the npm registries the project's
 * install needs. GitHub is not among them. The runtime downloads the pull
 * request's head and pushes the fix through the API itself, with a token
 * that never enters the sandbox, so nothing in here talks to GitHub. A
 * project whose install fetches from a git host fails to install, and the
 * chase reports that rather than widening this list.
 */
const REGISTRY_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com"];

/**
 * The chase's own sandbox, separate from the review's.
 *
 * @remarks
 * This sandbox runs a pull request's code: its install, type check, lint and
 * tests. So it holds no credential, and its egress is an allow-list set on
 * the factory rather than in `onSession`, because a replacement after a lost
 * sandbox does not run `onSession` again. Lifecycle scripts stay off at
 * install (`#lib/chase/checks`).
 *
 * Two vCPUs rather than the review's one, because an install and a test run
 * do real work. `push_fix` and `stop_chase` delete the sandbox when the chase
 * ends, and the one-day snapshot expiry covers a chase that ends any other
 * way. Bootstrap adds Bun and enables Corepack for pnpm and Yarn, with `sudo`
 * because the sandbox user cannot write the global prefix; Node and npm come
 * with the image. The allow-list already applies during bootstrap, which is
 * why Bun comes from the npm registry rather than its install script.
 */
export default defineSandbox({
  backend: vercel({
    keepLastSnapshots: { count: 1 },
    networkPolicy: { allow: REGISTRY_HOSTS },
    resources: { vcpus: 2 },
    snapshotExpiration: DAYS_MS,
  }),
  async bootstrap({ use }) {
    const sandbox = await use({
      keepLastSnapshots: { count: 1, expiration: 30 * DAYS_MS },
    });
    await sandbox.run({
      command: "command -v bun >/dev/null 2>&1 || sudo npm install -g bun",
    });
    await sandbox.run({ command: "sudo corepack enable || true" });
  },
  revalidationKey: () => "baymi-chase-v1",
});
