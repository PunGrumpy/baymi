import type { ChannelFrom, RouteDefinition } from "eve/channels";
import type { GitHubChannel, GitHubChannelState } from "eve/channels/github";

import { readCiTurn } from "#lib/github/ci/turn";
import { isApp } from "#lib/trust";

/**
 * Where an app turn on the GitHub channel runs: a session of its own, in
 * task mode.
 *
 * @remarks
 * eve's GitHub channel sends every dispatch to the pull request's address,
 * `repo:<id>:pull:<number>`, and passes no `mode`, so the turn joins the
 * session a review or a mention opened, and a session that does not exist yet
 * is created in conversation mode with `requestInput` on. A mode only takes
 * effect when a session is created: a delivery to a live session keeps that
 * session's mode. So setting the mode alone would not reach the common case,
 * a pull request whose review already opened its session.
 *
 * A chase is therefore sent to an address of its own, the pull request's
 * plus the chase key, with `mode: "task"`. A task-mode session is offered no
 * `ask_question`, and a turn in it that tries to park fails instead of
 * waiting (`docs/notes.md`). It also shares nothing with the review: no
 * history, no state, no turn a chase could steer into.
 *
 * Everything that is not the app passes through untouched, so a review, a
 * mention and the answer to a question keep the pull request's session.
 */

/** The address of one chase's session: the pull request's, then the chase key with only safe characters. */
export const chaseAddress = (pullRequestAddress: string, key: string): string =>
  `${pullRequestAddress}:ci:${key.replaceAll(/[^\w-]+/gu, "-")}`;

/** `from` as the route hands it to the dispatch, with app sends redirected. */
export const routeAppTurns =
  (from: ChannelFrom<GitHubChannelState>): ChannelFrom<GitHubChannelState> =>
  (address) => {
    const source = from(address);
    return {
      ...source,
      send(message, options) {
        if (!isApp(options.auth)) {
          return source.send(message, options);
        }
        const turn = readCiTurn(options.auth);
        const target =
          turn === null ? source : from(chaseAddress(address, turn.key));
        return target.send(message, { ...options, mode: "task" });
      },
    };
  };

const wrapRoute = (
  route: RouteDefinition<GitHubChannelState>
): RouteDefinition<GitHubChannelState> =>
  route.transport === "websocket"
    ? route
    : {
        ...route,
        handler: (request, args) =>
          route.handler(request, { ...args, from: routeAppTurns(args.from) }),
      };

/**
 * The channel with every HTTP route's `from` passed through `routeAppTurns`.
 *
 * @remarks
 * The webhook route is the only place eve hands the dispatch its `from`, and
 * `Channel.routes` is public, so this wraps that and nothing else: the
 * adapter, its event handlers and the proactive `receive` are the channel's
 * own.
 */
export const withChaseSessions = (channel: GitHubChannel): GitHubChannel => ({
  ...channel,
  routes: channel.routes.map(wrapRoute),
});
