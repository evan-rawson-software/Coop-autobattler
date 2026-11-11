/**
 * What the Shop and Build screens need of a run: the shared session, the
 * rules, and the storage state. Both the real run (`run-store.ts`) and the
 * dev sample routes (`shop-run.ts`) provide it.
 */
import type { RunDeps } from '@game/session';
import type { Store } from '../app-state.js';
import type { BuildSession } from '../build/session.js';

export interface RunHandle {
  readonly session: BuildSession;
  readonly deps: RunDeps;
  readonly runId: string;
  /** Where the run is saved; `memory` means it is lost on reload. */
  readonly storage: 'indexeddb' | 'local' | 'memory';
  /** True once the save changed in another tab; the session then refuses actions. */
  readonly conflict: Store<boolean>;
}
