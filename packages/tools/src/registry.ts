import { loadResources } from '@game/core';

/** Outcome of running a core loader on parsed content. */
export type LoaderResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface ContentEntry {
  /** Path relative to `content/`. */
  readonly contentFile: string;
  /** Path relative to `schemas/`. */
  readonly schemaFile: string;
  /** Core loader; receives the parsed JSON. */
  readonly load: (data: unknown) => LoaderResult;
}

/** Register new content files here: one row per file. */
export const contentRegistry: readonly ContentEntry[] = [
  {
    contentFile: 'resources.json',
    schemaFile: 'resources.schema.json',
    load: loadResources,
  },
];
