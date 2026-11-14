/** A moment (ms since the epoch) as YYYY-MM-DD in the viewer's local time. */
export function localIsoDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
