/**
 * The Ready button's state: pressing sends once, however often it is clicked
 * while the answer is pending; if the send did not succeed the button is
 * available again.
 */
export type ReadySend = () => Promise<boolean>;

export function createReadyGate(
  send: ReadySend,
  onChange: (ready: boolean) => void,
): () => void {
  let pressed = false;
  return () => {
    if (pressed) return;
    pressed = true;
    onChange(true);
    const outcome = send();
    outcome.then(
      (ok) => {
        if (!ok) {
          pressed = false;
          onChange(false);
        }
      },
      () => {
        pressed = false;
        onChange(false);
      },
    );
  };
}
