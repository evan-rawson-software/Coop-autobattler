/** Counts with the right noun: `count(1, 'wall')` is "1 wall", 2 is "2 walls". */

/** The noun alone: `plural(1, 'life', 'lives')` is "life". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** The count and the noun: "1 wall", "3 walls", "1 enemy unit". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${plural(n, one, many)}`;
}
