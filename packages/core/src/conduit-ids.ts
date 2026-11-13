/**
 * Conduit IDs (issue #38). Every player has their own conduit ID space, so
 * one player's adds, erases and undos can never touch another player's IDs.
 * The ID of a conduit is `n * MAX_PARTY_SIZE + owner`, where `n` counts from 1
 * in the owner's own counter (`TeamState.nextConduitId[owner]`). Buildings and
 * stash entries keep the shared `TeamState.nextId`.
 */

/** The largest party size any map can have (`maxPartySize` in mapgen.json). */
export const MAX_PARTY_SIZE = 4;

/** The conduit ID of a player's `n`th conduit (n starts at 1). */
export function encodeConduitId(owner: number, n: number): number {
  return n * MAX_PARTY_SIZE + owner;
}

/** The owner and counter value a conduit ID stands for. */
export function decodeConduitId(id: number): { owner: number; n: number } {
  return { owner: id % MAX_PARTY_SIZE, n: Math.floor(id / MAX_PARTY_SIZE) };
}
