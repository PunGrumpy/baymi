import { describe, expect, it } from "vitest";

import { repositoriesInstructions } from "#lib/repositories";

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
    // The whole point is to stop the model picking. With one repo there is
    // nothing to pick between, so naming it saves a question.
    expect(repositoriesInstructions(["PunGrumpy/baymi"])).toContain(
      "names no repository means `PunGrumpy/baymi`"
    );
    const several = repositoriesInstructions(["a/one", "b/two"]);
    expect(several).toContain("ask which of them");
    expect(several).not.toContain("names no repository means");
  });

  it("tells the model its own GitHub login is not an owner", () => {
    // `baymiai/baymi` is the guess that actually reached production and 404'd,
    // because instructions.md tells the agent it answers to that name.
    expect(repositoriesInstructions(["PunGrumpy/baymi"])).toContain("baymiai");
  });

  it("says why a wrong guess cannot be told apart from a missing repo", () => {
    // The recorded failure retried getRepository immediately. A retry cannot
    // work, because both cases return the same 404.
    expect(repositoriesInstructions(["PunGrumpy/baymi"])).toContain(
      "Not Found"
    );
  });
});
