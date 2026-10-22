import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

import { hasParsedFinding } from "./reply";

const DIFF = [
  "Review this pull request diff for security issues.",
  "",
  "```diff",
  "--- a/src/routes/admin.ts",
  "+++ b/src/routes/admin.ts",
  "@@ -10,6 +10,10 @@ router.get('/admin/users', requireAdmin, listUsers)",
  "+router.post('/admin/users/:id/role', async (req, res) => {",
  "+  await db.users.update({ where: { id: req.params.id }, data: { role: req.body.role } })",
  "+  res.sendStatus(204)",
  "+})",
  "```",
].join("\n");

export default defineEval({
  description:
    "Loads the review skill and reports the missing requireAdmin as one high or critical finding on admin.ts, in the format the channel parses.",
  tags: ["fast"],
  async test(t) {
    const turn = await t.send(DIFF);
    t.succeeded();
    t.loadedSkill("security-review");
    t.check(turn.message, includes(/^Security review: 1 finding/u));
    t.check(turn.message, includes(/^### (?:Critical|High) · /mu));
    t.check(turn.message, includes(/^File: `?src\/routes\/admin\.ts/mu));
    t.check(turn.message, includes(/requireAdmin/u));
    // The patterns above read the shape; this reads it the way the channel
    // does, so a reply the channel could not place on a line fails here.
    t.check(
      turn.message,
      satisfies<string | undefined>(
        (reply) =>
          hasParsedFinding(reply, "src/routes/admin.ts", ["critical", "high"]),
        "parses through the channel's parseReview into an inline finding on src/routes/admin.ts"
      )
    );
  },
});
