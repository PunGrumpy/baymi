import { describe, expect, it } from "vitest";

/**
 * The GitHub channel's configuration, read off the module eve loads.
 *
 * @remarks
 * `agent/channels/github.ts` is wiring and has no test of its own, but the
 * few settings that keep an app turn off the pull request are worth one: a
 * refactor that drops them would pass every test of the logic they protect.
 * The module validates `#lib/env` when it loads, so the variables it requires
 * are set to placeholders first; nothing here calls GitHub or Slack.
 */
const loadChannel = async () => {
  process.env.GITHUB_CONNECTOR ??= "github/test";
  process.env.GITHUB_WEBHOOK_SECRET ??= "placeholder";
  process.env.SLACK_CONNECTOR ??= "slack/test";
  const module = await import("#channels/github");
  return module.default;
};

describe("the GitHub channel", () => {
  it("queues a message that arrives during a turn instead of steering into it", async () => {
    const channel = await loadChannel();
    expect(channel.turnPolicy).toBe("queue");
  });
});
