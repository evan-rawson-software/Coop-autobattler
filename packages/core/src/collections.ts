/**
 * The sanctioned ways to read a whole Map or Set in rules code.
 *
 * JavaScript iterates a Map or Set in insertion order; a C# Dictionary or
 * HashSet promises no order at all. So rules code never iterates one directly
 * (lint rule `determinism/no-collection-iteration`): it keeps an array next to
 * it, or reads the contents through these helpers, which sort by key first.
 */

/** The numbers of a set, ascending. */
export function sortedInts(set: ReadonlySet<number>): number[] {
  // eslint-disable-next-line determinism/no-collection-iteration -- sorted here
  return [...set].sort((a, b) => a - b);
}

/** The entries of a map with integer keys, by ascending key. */
export function sortedIntEntries<V>(
  map: ReadonlyMap<number, V>,
): [number, V][] {
  // eslint-disable-next-line determinism/no-collection-iteration -- sorted here
  return [...map].sort((a, b) => a[0] - b[0]);
}
