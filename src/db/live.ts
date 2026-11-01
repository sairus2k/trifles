import { liveQuery } from "dexie";
import { type Accessor, createMemo, from } from "solid-js";

// Solid 2's from() closes the Dexie subscription when the memo re-runs and when its owner is
// disposed, so cleanup and re-subscription need no hand-written onCleanup. Until the first result
// arrives the accessor is pending: render it inside <Loading>; a failed query surfaces in <Errored>.

/** Live result of a Dexie query; re-runs whenever the tables it read change. */
export function createLiveQuery<T>(query: () => T | Promise<T>): Accessor<T>;
/**
 * Same, with a reactive parameter. Dexie runs the query outside Solid's tracking, so reactive reads
 * belong in `source`: when it changes, the old subscription closes and a new one opens.
 */
export function createLiveQuery<S, T>(
  source: Accessor<S>,
  query: (source: S) => T | Promise<T>,
): Accessor<T>;
export function createLiveQuery<S, T>(
  ...args:
    | [query: () => T | Promise<T>]
    | [source: Accessor<S>, query: (source: S) => T | Promise<T>]
): Accessor<T> {
  if (args.length === 1) {
    const [query] = args;
    return createMemo(() => from(liveQuery(query)));
  }
  const [source, query] = args;
  return createMemo(() => {
    const value = source();
    return from(liveQuery(() => query(value)));
  });
}
