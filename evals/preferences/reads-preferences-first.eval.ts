import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Starts a task by reading the caller's standing preferences. Needs Vercel Blob credentials.",
  tags: ["needs-connect"],
  async test(t) {
    await t.send("Put together this week's issues digest for me.");
    t.calledTool("get_user_preferences");
  },
});
