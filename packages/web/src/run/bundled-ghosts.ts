/**
 * The bundled ghosts (W3-2) as a read-only pool source. The file is a
 * separate chunk, loaded by the first read of the pool (the shop before a
 * PvP battle), never on the first paint. A missing, unreadable or invalid
 * file, or one made for another game version, leaves the pool local only.
 */
import {
  bundledGhostsOf,
  createBundledGhostStore,
  type GhostStore,
} from '@game/session';

/** The bundled store for a game version (`major.minor`), or null. */
export async function loadBundledGhostStore(
  version: string,
  load: () => Promise<unknown> = async () =>
    (await import('./bundled-ghosts.json')).default,
): Promise<GhostStore | null> {
  try {
    const rows = bundledGhostsOf(await load(), version);
    return rows.length === 0 ? null : createBundledGhostStore(rows);
  } catch {
    return null;
  }
}
