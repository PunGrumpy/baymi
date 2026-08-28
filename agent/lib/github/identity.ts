import { BOT_NAME } from "#lib/github/comments";

/**
 * The App's bot account, as GitHub names it.
 *
 * @remarks
 * Derived from {@link BOT_NAME} rather than written out, so the login the
 * agent commits under and the login `isIgnoredComment` refuses to answer stay
 * the same string.
 */
export const BOT_LOGIN = `${BOT_NAME}[bot]`;

/**
 * The numeric id of that account, which only GitHub can issue.
 *
 * @remarks
 * A bot's no-reply address is `<id>+<login>@users.noreply.github.com`, and the
 * id is the half that does the work: GitHub matches the commit to the account
 * on it, not on the login. Read back with
 * `GET /users/baymiai%5Bbot%5D` if the App is ever re-registered.
 */
const BOT_USER_ID = 316_465_765;

/**
 * A GitHub no-reply address for an account.
 *
 * @remarks
 * This is the whole reason the identity is pinned. Commit under any other
 * address and GitHub has nothing to resolve: the commit shows a bare name with
 * no avatar and no link, and it counts for nobody. Commit under this one and
 * it is attributed to the App.
 */
export const noreplyEmail = (userId: number, login: string): string =>
  `${userId}+${login}@users.noreply.github.com`;

/** The address the agent's own commits are authored from. */
export const BOT_EMAIL = noreplyEmail(BOT_USER_ID, BOT_LOGIN);

/**
 * The git configuration a sandbox needs before the agent commits in it.
 *
 * @remarks
 * Global rather than per-repository, because the agent clones whatever
 * repository the work is in and there is no point in the checkout where a
 * per-repository setting could be applied first.
 *
 * Without this, git in a fresh sandbox has no identity at all, and the model
 * answers the resulting error the only way it can: by guessing one. It calls
 * itself Baymi, so it guesses `baymi`, which is a different account belonging
 * to someone else. The identity is configuration, not something to leave to
 * the model.
 *
 * One command rather than two, because both halves write the same
 * `~/.gitconfig` and git takes a lock to do it; run apart they are two round
 * trips into the sandbox, run together they are a race for that lock.
 */
export const GIT_IDENTITY_COMMAND = `git config --global user.name '${BOT_LOGIN}' && git config --global user.email '${BOT_EMAIL}'`;
