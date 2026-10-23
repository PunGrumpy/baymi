import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import {
  HEALTHY,
  WAITING,
  digestTurn,
  namedPullRequests,
  namesAPullRequest,
  pullRequestLinks,
} from "./fixtures";

/**
 * The most lines a digest with nothing for the owner may take: the sentence
 * saying so, and the one line of counts the engineering-lead skill puts last.
 */
const QUIET_MAX_LINES = 2;

const isQuiet = (reply: string): boolean =>
  reply.split("\n").filter((line) => line.trim() !== "").length <=
  QUIET_MAX_LINES;

export default defineEval({
  description:
    "Stays quiet when every pull request is healthy, and leads with the one that needs PunGrumpy when one does.",
  tags: ["fast", "lead"],
  async test(t) {
    const quiet = await t.send(digestTurn([], HEALTHY));
    t.check(
      quiet.message,
      satisfies<string>(
        isQuiet,
        "quiet digest is a sentence and at most one line of counts"
      )
    ).label("quiet: short");
    t.check(
      quiet.message,
      satisfies<string>(
        (reply) => !namesAPullRequest(reply),
        "quiet digest names no pull request"
      )
    ).label("quiet: names none");
    t.judge(
      "The reply opens by saying, in Thai or English, that nothing needs PunGrumpy's attention. After that it has at most one line that counts the healthy pull requests. It does not list, link, or name any pull request, and it does not offer to do more."
    )
      .label("quiet: says nothing needs attention")
      .atLeast(0.7);

    const waiting = await t.send(digestTurn([WAITING], HEALTHY));
    t.check(
      waiting.message,
      satisfies<string>(
        (reply) => pullRequestLinks(reply)[0] === WAITING.url,
        "the first pull request link is the one waiting on the owner"
      )
    ).label("waiting: leads with the link");
    t.check(
      waiting.message,
      satisfies<string>(
        (reply) =>
          namedPullRequests(reply).every((number) =>
            WAITING.url.endsWith(`/${number}`)
          ),
        "no other pull request is named"
      )
    ).label("waiting: names only the waiting one");
    t.judge(
      "The reply tells PunGrumpy, in Thai or English, that the pull request is green and waiting for them to merge it. It does not say the pull request was merged or that it will merge it. The other pull requests appear at most as a line of counts, with no link and no title."
    )
      .label("waiting: asks for the merge")
      .atLeast(0.7);

    t.succeeded();
  },
});
