/**
 * Notes about where saves live, on every screen: another tab is upgrading the
 * saves, this tab must reload after such an upgrade, or the browser database
 * could not be used and another storage is in use.
 */
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { storageStatus } from './services.js';

/** How long a blocked open is waited out before the player is told. */
export const BLOCKED_NOTE_DELAY_MS = 1500;

export const BLOCKED_TEXT =
  'Another tab is upgrading the saves. Waiting for it to finish; close the other tab if this does not go on.';
export const RELOAD_TEXT =
  'Another tab upgraded the saves, so this tab can no longer save. Reload the page to continue.';

export function StorageNotes() {
  const st = useStore(storageStatus);
  const [showBlocked, setShowBlocked] = useState(false);
  useEffect(() => {
    if (!st.blocked) {
      setShowBlocked(false);
      return;
    }
    const t = window.setTimeout(() => {
      setShowBlocked(true);
    }, BLOCKED_NOTE_DELAY_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [st.blocked]);
  if (!showBlocked && !st.reloadNeeded && st.fallbackNote === null) return null;
  return (
    <div class="storage-notes" id="storage-notes" role="status">
      {st.reloadNeeded ? (
        <p data-field="reload">
          {RELOAD_TEXT}{' '}
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </p>
      ) : null}
      {showBlocked ? <p data-field="blocked">{BLOCKED_TEXT}</p> : null}
      {st.fallbackNote === null ? null : (
        <p data-field="fallback">{st.fallbackNote}</p>
      )}
    </div>
  );
}
