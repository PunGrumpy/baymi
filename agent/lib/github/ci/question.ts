import type { SessionAuthContext } from "eve/context";

import { isApp } from "#lib/trust";

/**
 * What happens to a question a turn on the GitHub channel asks.
 *
 * @remarks
 * eve's built-in `input.requested` handler posts the question as a comment on
 * the pull request and the session waits for a reply. For a person who
 * mentioned the agent that is the conversation working. For the app it is a
 * public comment nobody asked for, on a pull request nobody is watching for
 * one, so the channel replaces the handler and the app's question is
 * dropped: nothing is posted and the reason is logged. A chase runs in task
 * mode (`./session.ts`), which offers it no `ask_question` and fails a turn
 * that tries to wait, so this is the second lock on that door, not the first.
 *
 * A handler replaces the built-in for everyone, so a person's question is
 * rendered here the way eve's default renders it.
 */

export type QuestionRoute = "drop" | "post";

/** `input.requested`: the app's question is dropped, anyone else's is posted. */
export const questionRoute = (
  auth: SessionAuthContext | null
): QuestionRoute => (isApp(auth) ? "drop" : "post");

/** The fields of one input request the prompt is built from. */
export interface QuestionRequest {
  readonly allowFreeform?: boolean;
  readonly options?: readonly {
    readonly description?: string;
    readonly label: string;
  }[];
  readonly prompt: string;
}

const renderRequest = (request: QuestionRequest): string => {
  const lines = [request.prompt];
  const options = request.options ?? [];
  if (options.length > 0) {
    lines.push(
      "",
      ...options.map(
        (option, index) =>
          `${index + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`
      )
    );
  }
  if (request.allowFreeform === true) {
    lines.push("", "You can also reply with a custom answer.");
  }
  return lines.join("\n");
};

/**
 * The comment eve's default posts for a batch of requests: each prompt with
 * its numbered options, then how to answer. `null` when there is nothing to
 * ask.
 */
export const renderQuestions = (
  requests: readonly QuestionRequest[],
  botName: string
): string | null => {
  if (requests.length === 0) {
    return null;
  }
  const example =
    requests.find((request) => (request.options?.length ?? 0) > 0)?.options?.[0]
      ?.label ?? "<your answer>";
  return [
    ...requests.map(renderRequest),
    `Answer by mentioning me in a reply, e.g. \`@${botName} ${example}\`.`,
  ].join("\n\n");
};
