import type { SessionAuthContext } from "eve/context";
import { describe, expect, it } from "vitest";

import type { MemoryAccess, TrustClass } from "#lib/trust";
import {
  APP_PRINCIPAL,
  classifyPrincipal,
  isApp,
  isReviewer,
  isSlackHuman,
  isTrustedGitHubAssociation,
  isLocalDev,
  isUnattended,
  mayChase,
  memoryAccess,
  REVIEWER_PRINCIPAL,
  TRUST_CLASSES,
} from "#lib/trust";

const auth = (overrides: Partial<SessionAuthContext>): SessionAuthContext => ({
  attributes: {},
  authenticator: "slack-webhook",
  principalId: "slack:T0AAAAAAA:U0BBBBBBB",
  principalType: "user",
  ...overrides,
});

/** What `defaultGitHubAuth` mints for `login` on a repository `owner` owns. */
const gitHubPerson = (login: string, owner = "PunGrumpy") =>
  auth({
    attributes: {
      repository: `${owner}/baymi`,
      user_login: login,
      user_type: "User",
    },
    authenticator: "github-webhook",
    issuer: `github:${owner}`,
    principalId: "github:42",
    subject: login,
  });

/**
 * The runtime principal of a schedule fire, as `eve dev` 0.62.0 reported it
 * from a markdown schedule's turn (`auth.current` and `auth.initiator` alike)
 * and from a handler schedule's `appAuth` (`docs/notes.md`).
 */
const MEASURED_APP_PRINCIPAL: SessionAuthContext = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
};

/** The reviewer, built the way `onPullRequest` builds it: on the author's auth. */
const reviewerOn = (author: string) => ({
  ...gitHubPerson(author),
  principalId: REVIEWER_PRINCIPAL,
  principalType: "service",
});

/** One fixture principal per class; the type forces a row for a new class. */
const FIXTURES = {
  app: MEASURED_APP_PRINCIPAL,
  collaborator: gitHubPerson("octocat"),
  maintainer: gitHubPerson("PunGrumpy"),
  reviewer: reviewerOn("octocat"),
  stranger: auth({
    authenticator: "github-webhook",
    principalId: "github:99",
    principalType: "service",
  }),
} as const satisfies Record<TrustClass, SessionAuthContext>;

const ACCESS = {
  app: "read",
  collaborator: "none",
  maintainer: "write",
  reviewer: "none",
  stranger: "none",
} as const satisfies Record<TrustClass, MemoryAccess>;

describe(isTrustedGitHubAssociation, () => {
  it("trusts the roles with write access to the repository", () => {
    for (const role of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(isTrustedGitHubAssociation(role)).toBeTruthy();
    }
  });

  it("does not trust contributors, first-timers, or anyone else", () => {
    for (const role of [
      "CONTRIBUTOR",
      "FIRST_TIME_CONTRIBUTOR",
      "FIRST_TIMER",
      "NONE",
      "MANNEQUIN",
    ]) {
      expect(isTrustedGitHubAssociation(role)).toBeFalsy();
    }
  });

  it("treats a missing or malformed value as untrusted", () => {
    // `raw` is untyped JSON, so the field can be absent or anything at all.
    expect(isTrustedGitHubAssociation()).toBeFalsy();
    expect(isTrustedGitHubAssociation(null)).toBeFalsy();
    expect(isTrustedGitHubAssociation("owner")).toBeFalsy();
    expect(isTrustedGitHubAssociation(1)).toBeFalsy();
  });
});

describe(classifyPrincipal, () => {
  it("puts each fixture principal in its own class", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(classifyPrincipal(FIXTURES[trustClass])).toBe(trustClass);
    }
  });

  it("recognizes the app by the principal eve measured for a schedule", () => {
    expect(APP_PRINCIPAL).toBe(MEASURED_APP_PRINCIPAL.principalId);
    expect(classifyPrincipal(MEASURED_APP_PRINCIPAL)).toBe("app");
  });

  it("does not read the app's id as the app unless it is the runtime", () => {
    expect(
      classifyPrincipal(
        auth({ ...MEASURED_APP_PRINCIPAL, principalType: "user" })
      )
    ).toBe("stranger");
    // A Vercel OIDC token for this project is a runtime principal too, under
    // its own `<issuer>:<subject>` id.
    expect(
      classifyPrincipal(
        auth({
          authenticator: "oidc",
          issuer: "https://oidc.vercel.com/team",
          principalId: "https://oidc.vercel.com/team:project",
          principalType: "runtime",
        })
      )
    ).toBe("stranger");
  });

  it("keeps the reviewer a reviewer even on the repository owner's pull request", () => {
    // The reviewer principal is built on the author's auth, so the author's
    // login is the owner's. It must still never be read as the maintainer.
    expect(classifyPrincipal(reviewerOn("PunGrumpy"))).toBe("reviewer");
  });

  it("makes the repository's owner the maintainer, whatever the login's case", () => {
    expect(classifyPrincipal(gitHubPerson("PunGrumpy"))).toBe("maintainer");
    expect(classifyPrincipal(gitHubPerson("pungrumpy"))).toBe("maintainer");
  });

  it("makes any other person the mention gate admitted a collaborator", () => {
    expect(classifyPrincipal(gitHubPerson("octocat"))).toBe("collaborator");
    // On an organization's repository nobody is the owner.
    expect(classifyPrincipal(gitHubPerson("PunGrumpy", "some-org"))).toBe(
      "collaborator"
    );
  });

  it("never reads a GitHub person with no login as the owner", () => {
    expect(
      classifyPrincipal(
        auth({
          authenticator: "github-webhook",
          issuer: "github:PunGrumpy",
          principalId: "github:42",
        })
      )
    ).toBe("collaborator");
  });

  it("makes a person of the Slack workspace the maintainer", () => {
    expect(classifyPrincipal(auth({}))).toBe("maintainer");
    expect(classifyPrincipal(auth({}), { slackTeamId: "T0AAAAAAA" })).toBe(
      "maintainer"
    );
  });

  it("makes a Slack human of another workspace a stranger once a team is pinned", () => {
    expect(classifyPrincipal(auth({}), { slackTeamId: "T0ZZZZZZZ" })).toBe(
      "stranger"
    );
  });

  it("makes the operator at a terminal or in the Vercel team the maintainer", () => {
    expect(
      classifyPrincipal(
        auth({
          authenticator: "local-dev",
          principalId: "local-dev",
          principalType: "local-dev",
        })
      )
    ).toBe("maintainer");
    expect(
      classifyPrincipal(
        auth({
          authenticator: "oidc",
          principalId: "https://oidc.vercel.com/team:user_1",
          principalType: "user",
        })
      )
    ).toBe("maintainer");
  });

  it("gives everything else nothing", () => {
    expect(classifyPrincipal(null)).toBe("stranger");
    expect(
      classifyPrincipal(
        auth({
          authenticator: "anonymous",
          principalId: "anonymous",
          principalType: "anonymous",
        })
      )
    ).toBe("stranger");
    expect(
      classifyPrincipal(
        auth({ principalId: "eve:evals", principalType: "service" })
      )
    ).toBe("stranger");
    expect(
      classifyPrincipal(
        auth({
          principalId: "slack:T0AAAAAAA:bot:B0CCCCCCC",
          principalType: "service",
        })
      )
    ).toBe("stranger");
  });
});

describe(isUnattended, () => {
  it("is true for the reviewer and the app, and for no one else", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(isUnattended(FIXTURES[trustClass])).toBe(
        trustClass === "reviewer" || trustClass === "app"
      );
    }
    expect(isUnattended(null)).toBeFalsy();
  });
});

describe(isReviewer, () => {
  it("is true for the reviewer only, not for the app", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(isReviewer(FIXTURES[trustClass])).toBe(trustClass === "reviewer");
    }
    expect(isReviewer(null)).toBeFalsy();
  });
});

describe(isApp, () => {
  it("is true for the app only", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(isApp(FIXTURES[trustClass])).toBe(trustClass === "app");
    }
    expect(isApp(null)).toBeFalsy();
  });
});

describe(memoryAccess, () => {
  it("lets the maintainer read and write, the app read, and no one else in", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(memoryAccess(FIXTURES[trustClass])).toBe(ACCESS[trustClass]);
    }
    expect(memoryAccess(null)).toBe("none");
  });

  it("counts the Slack pin, so a guest from another workspace gets none", () => {
    expect(memoryAccess(auth({}), { slackTeamId: "T0AAAAAAA" })).toBe("write");
    expect(memoryAccess(auth({}), { slackTeamId: "T0ZZZZZZZ" })).toBe("none");
  });
});

describe(isSlackHuman, () => {
  it("admits a person delivered by the Slack channel", () => {
    expect(isSlackHuman(auth({}))).toBeTruthy();
  });

  it("keeps bots out, including other apps in the workspace", () => {
    expect(
      isSlackHuman(
        auth({
          principalId: "slack:T0AAAAAAA:bot:B0CCCCCCC",
          principalType: "service",
        })
      )
    ).toBeFalsy();
  });

  it("pins the workspace when a team id is configured", () => {
    // A Slack Connect guest arrives as a human of another team; the pin is
    // what keeps them out.
    expect(isSlackHuman(auth({}), "T0AAAAAAA")).toBeTruthy();
    expect(isSlackHuman(auth({}), "T0ZZZZZZZ")).toBeFalsy();
  });

  it("never admits a principal from another channel", () => {
    expect(
      isSlackHuman(
        auth({ authenticator: "github-webhook", principalId: "github:42" })
      )
    ).toBeFalsy();
  });
});

describe(mayChase, () => {
  const CHASE = {
    app: true,
    collaborator: false,
    maintainer: true,
    reviewer: false,
    stranger: false,
  } as const satisfies Record<TrustClass, boolean>;

  it("admits the app and the maintainer, and no other class", () => {
    for (const trustClass of TRUST_CLASSES) {
      expect(mayChase(FIXTURES[trustClass])).toBe(CHASE[trustClass]);
    }
    expect(mayChase(null)).toBeFalsy();
  });

  it("refuses the terminal, which is the maintainer for everything else", () => {
    const terminal = auth({
      authenticator: "local-dev",
      principalId: "local-dev",
      principalType: "local-dev",
    });
    expect(classifyPrincipal(terminal)).toBe("maintainer");
    expect(isLocalDev(terminal)).toBeTruthy();
    expect(mayChase(terminal)).toBeFalsy();
  });

  it("admits a person on Slack only in the pinned workspace", () => {
    expect(mayChase(auth({}), { slackTeamId: "T0AAAAAAA" })).toBeTruthy();
    expect(mayChase(auth({}), { slackTeamId: "T0ZZZZZZZ" })).toBeFalsy();
  });
});
