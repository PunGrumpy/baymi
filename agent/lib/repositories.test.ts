import { describe, expect, it } from "vitest";

import { repositoriesInstructions } from "#lib/repositories";

/** The shape the incident happened under: one repository, owned by a person. */
const single = repositoriesInstructions(["PunGrumpy/baymi"]);

describe(repositoriesInstructions, () => {
  it("names every repository it was given", () => {
    const markdown = repositoriesInstructions([
      "PunGrumpy/baymi",
      "PunGrumpy/logixlysia",
    ]);
    expect(markdown).toContain("`PunGrumpy/baymi`");
    expect(markdown).toContain("`PunGrumpy/logixlysia`");
  });

  it("resolves an unnamed repository only when there is one to resolve to", () => {
    // With one repo there is nothing to pick between, so naming it saves a
    // question. With several, picking is what this fragment exists to stop.
    expect(single).toContain("names no repository means `PunGrumpy/baymi`");
    const several = repositoriesInstructions(["a/one", "b/two"]);
    expect(several).toContain("ask which one");
    expect(several).not.toContain("names no repository means");
  });

  it("does not present the list as the limit of what it may answer", () => {
    // DIGEST_REPOS bounds the digest and `git_push`, not which mentions the
    // agent may answer: that is the App install plus the trust gate. Claiming
    // otherwise would have it refuse a real mention on an undigested repo.
    expect(single).toContain("listed here or not");
    expect(single).not.toContain("whole list");
    // A repository outside the list is usable, it just may not be invented.
    expect(single).toContain("Use exactly the owner and name you were given");
  });

  it("tells the model its own GitHub login is not an owner", () => {
    // `baymiai/baymi` is the guess that actually reached production and 404'd,
    // because instructions.md tells the agent it answers to that name.
    expect(single).toContain("baymiai");
  });

  it("says why a wrong guess cannot be told apart from a missing repo", () => {
    // The recorded failure retried getRepository immediately. A retry cannot
    // work, because both cases return the same 404.
    expect(single).toContain("Not Found");
  });
});
