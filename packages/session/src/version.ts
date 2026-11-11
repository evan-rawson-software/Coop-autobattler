/**
 * Version helpers (TA-8, TA-9, CP-23e). The installed game has a version
 * `major.minor.patch`; a run has `major.minor`. Patches never matter to a run.
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  /** Null for a run version. */
  readonly patch: number | null;
}

export type VersionClass = 'same' | 'older_minor' | 'older_major' | 'newer';

const PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/;

/** Parse `major.minor` or `major.minor.patch`; null if it is neither. */
export function parseVersion(text: unknown): ParsedVersion | null {
  if (typeof text !== 'string') return null;
  const m = PATTERN.exec(text);
  if (m === null) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] === undefined ? null : Number(m[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    (patch !== null && !Number.isSafeInteger(patch))
  ) {
    return null;
  }
  return { major, minor, patch };
}

/** Compare two version strings (a missing patch counts as 0). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new RangeError(`not a version: "${a}"`);
  if (pb === null) throw new RangeError(`not a version: "${b}"`);
  const ka = [pa.major, pa.minor, pa.patch ?? 0] as const;
  const kb = [pb.major, pb.minor, pb.patch ?? 0] as const;
  for (let i = 0; i < 3; i++) {
    const x = ka[i] ?? 0;
    const y = kb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * How a run relates to the installed game. Only major and minor count:
 * `same`, `older_minor` (same major, lower minor), `older_major`, or `newer`
 * (the run is from a later version than the installed game).
 * Throws `RangeError` for a string that is not a version.
 */
export function classify(
  runVersion: string,
  installedVersion: string,
): VersionClass {
  const r = parseVersion(runVersion);
  const i = parseVersion(installedVersion);
  if (r === null) throw new RangeError(`not a version: "${runVersion}"`);
  if (i === null) throw new RangeError(`not a version: "${installedVersion}"`);
  if (r.major !== i.major) return r.major < i.major ? 'older_major' : 'newer';
  if (r.minor !== i.minor) return r.minor < i.minor ? 'older_minor' : 'newer';
  return 'same';
}
