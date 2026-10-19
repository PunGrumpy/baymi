/**
 * The model every agent here runs on, named by its AI Gateway id.
 *
 * @remarks
 * eve routes a `provider/model` string through Vercel AI Gateway and
 * authenticates with the deployment's OIDC token, so there is no endpoint or
 * key to configure. `scripts/review-bench.ts` chose it (`docs/notes.md`): it
 * found 24 of 24 planted flaws, flagged none of the clean diffs, and calls
 * tools natively. The gateway's free tier admits it, and most of the
 * catalog it does not.
 */
export const MODEL = "moonshotai/kimi-k2.7-code";
