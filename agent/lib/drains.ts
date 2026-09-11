import type { DrainContext } from "evlog";

/** One place a wide event is sent. Batched, so a destination sees a list. */
export type DrainDestination = (batch: DrainContext[]) => void | Promise<void>;

/**
 * Fans one wide event out to several destinations, isolating each one.
 *
 * @remarks
 * A destination that throws or hangs must not take the others with it, and
 * it must not fail the turn that produced the event: an agent that stops
 * answering because a log shipper is down has traded the product for its
 * instrumentation. Every failure is swallowed after one line on the console.
 *
 * Returns `undefined` when there is no destination at all, which is the value
 * `defineEvlogHook` treats as "no drain".
 */
export const createFanOutDrain = (
  destinations: readonly DrainDestination[]
): ((ctx: DrainContext) => Promise<void>) | undefined => {
  if (destinations.length === 0) {
    return;
  }
  return async (ctx: DrainContext) => {
    await Promise.all(
      destinations.map(async (destination) => {
        try {
          await destination([ctx]);
        } catch (error) {
          console.error("[baymi] a wide-event destination failed", error);
        }
      })
    );
  };
};
