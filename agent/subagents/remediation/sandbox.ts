import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

const DAYS_MS = 24 * 60 * 60 * 1000;

/**
 * The only hosts the sandbox can reach. Installing a bumped npm package
 * needs the registry, and nothing else the subagent does needs the network:
 * the runtime downloads the repository and pushes the result itself.
 */
const REGISTRY_HOSTS = ["registry.npmjs.org", "registry.yarnpkg.com"];

/**
 * The remediation subagent's own sandbox, separate from the review's.
 *
 * @remarks
 * This sandbox runs code: the package manager, and the project's type check,
 * lint and tests against a dependency version nobody has read. So it holds
 * no credential, and its egress is an allow-list set on the factory rather
 * than in `onSession`, because a replacement after a lost sandbox does not
 * run `onSession` again. Lifecycle scripts stay off at install
 * (`#lib/remediation/checks`).
 *
 * Two vCPUs rather than the review's one, because an install and a test run
 * do real work. The `submit_fix` tool deletes the sandbox once the pull
 * request is open, and the one-day snapshot expiry covers a run that ends
 * any other way. Bootstrap adds Bun and enables Corepack for pnpm and Yarn,
 * with `sudo` because the sandbox user cannot write the global prefix; Node
 * and npm come with the image. The factory's allow-list already applies
 * during bootstrap, which is why Bun comes from the npm registry rather than
 * its install script.
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
  revalidationKey: () => "baymi-remediation-v1",
});
