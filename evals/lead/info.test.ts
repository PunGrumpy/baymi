import { describe, expect, it } from "vitest";

import {
  declaredToolNames,
  isMergeLike,
  mountsMergeTool,
  readAgentInfo,
} from "./info";

const INFO = {
  mode: "development",
  tools: {
    dynamic: [{ logicalPath: "tools/file.ts", slug: "file" }],
    static: [{ logicalPath: "tools/read_file.ts" }],
  },
};

const target = (body: typeof INFO | { readonly mode: string }) => ({
  fetch: () => Promise.resolve(Response.json(body)),
});

describe("reading what the agent reports", () => {
  it("lists static and dynamic tools by path and slug", async () => {
    const info = await readAgentInfo(target(INFO));
    expect(declaredToolNames(info)).toStrictEqual([
      "tools/read_file.ts",
      "tools/file.ts",
      "file",
    ]);
  });

  it("rejects a response that is not agent info", async () => {
    await expect(
      readAgentInfo(target({ mode: "development" }))
    ).rejects.toThrow("tools");
  });
});

describe("telling a merge tool from the rest", () => {
  it.each([
    "mergePullRequest",
    "github__mergePullRequest",
    "tools/merge_pull_request.ts",
    "enableAutoMerge",
  ])("catches %s", (name) => {
    expect(isMergeLike(name)).toBeTruthy();
  });

  it("passes the tools the app mounts today", () => {
    expect(
      mountsMergeTool([
        "addPullRequestComment",
        "getPullRequestContext",
        "rerunWorkflowRun",
        "tools/read_file.ts",
        "github__github",
      ])
    ).toBeFalsy();
  });

  it("fails a list that holds one merge tool", () => {
    expect(
      mountsMergeTool(["getFileContent", "mergePullRequest"])
    ).toBeTruthy();
  });
});
