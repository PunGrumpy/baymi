import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

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
    "Loads the review skill and writes a finding with a file, a line, the attacker's move, and a fix.",
  tags: ["fast"],
  async test(t) {
    await t.send(DIFF);
    t.succeeded();
    t.loadedSkill("security-review");
    t.check(t.reply, includes(/security review/iu));
    t.check(t.reply, includes(/admin\.ts/u));
    t.judge.autoevals
      .closedQA(
        "The response reports that the new POST route lacks the requireAdmin middleware its sibling route has, so any caller can change any user's role, and rates it high or critical. It names the file, says what an attacker does, why the code allows it, and what closes it. It does not comment on style."
      )
      .atLeast(0.7);
  },
});
