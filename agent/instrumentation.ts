import { trace } from "@opentelemetry/api";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";

import { env } from "#lib/env";

/**
 * Exports the AI SDK's spans to PostHog, so a turn can be opened up into the
 * model calls it was actually made of.
 *
 * @remarks
 * eve already registers the AI SDK's OpenTelemetry integration, so every model
 * call emits a span whether or not this file exists. All this adds is a
 * destination. What it buys over `agent/hooks/evlog.ts` is resolution: the wide
 * event says a turn took 33 model calls and 55 seconds, and these spans say
 * which of the 33 was the slow one.
 *
 * `recordInputs` and `recordOutputs` are eve's defaults, written out anyway
 * because they are the whole privacy posture of this file and a default is a
 * quiet thing to inherit. With both off the spans carry model, token counts,
 * cost, latency and tool names, and never a prompt or a completion, which is
 * the same line `agent/hooks/evlog.ts` holds with `message: "omit"`. Turning
 * either on sends issue bodies, Slack messages and saved preferences other
 * people wrote to a third party, so it is a decision to take deliberately and
 * document, not a flag to flip while debugging.
 *
 * The token is `POSTHOG_API_KEY`, the same one the turn drain uses, rather than
 * the `POSTHOG_PROJECT_TOKEN` the registry template introduces: they are the
 * same `phc_` value, and a second name for one secret is a thing to keep in
 * sync forever. Without it `setup` registers nothing, so a fresh checkout boots
 * and traces locally with nowhere to export to.
 */
export default defineInstrumentation({
  events: {
    "step.started"(input) {
      // The same principal the PostHog drain uses as its distinct id, so one
      // person is one person across `baymi_turn` and the generation spans
      // instead of two unrelated rows that happen to describe the same caller.
      const distinctId =
        input.session.auth.initiator?.principalId ??
        input.session.auth.current?.principalId;
      if (!distinctId) {
        return;
      }
      trace.getActiveSpan()?.setAttribute("posthog.distinct_id", distinctId);
      return { runtimeContext: { posthog_distinct_id: distinctId } };
    },
  },
  // Metadata only. See the remark above before changing either.
  recordInputs: false,
  recordOutputs: false,
  setup: ({ agentName }) => {
    if (!env.POSTHOG_API_KEY) {
      return;
    }
    // The processor rather than the bare exporter the registry template used:
    // it implements `shutdown` and `forceFlush`, so a serverless invocation
    // that ends before an export lands still flushes it. An absent host is the
    // US cloud, which is the processor's own default.
    const processor = new PostHogSpanProcessor({
      host: env.POSTHOG_HOST,
      projectToken: env.POSTHOG_API_KEY,
    });
    registerOTel({ serviceName: agentName, spanProcessors: [processor] });
  },
});
