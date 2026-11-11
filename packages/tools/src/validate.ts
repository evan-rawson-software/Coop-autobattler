import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ContentEntry, LoadedContent } from './registry.js';

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Validate every registry entry: JSON Schema first, then the core loader.
 * Returns readable problem lines; empty means all good.
 */
export function validateContent(
  repoRoot: string,
  registry: readonly ContentEntry[],
): string[] {
  const problems: string[] = [];
  const loadedContent: LoadedContent = {};
  for (const entry of registry) {
    const contentPath = path.join(repoRoot, 'content', entry.contentFile);
    const schemaPath = path.join(repoRoot, 'schemas', entry.schemaFile);
    const label = `content/${entry.contentFile}`;
    let data: unknown;
    let schema: object;
    try {
      data = readJson(contentPath);
      schema = readJson(schemaPath) as object;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    if (!validate(data)) {
      for (const err of validate.errors ?? []) {
        problems.push(
          `${label}: schema: ${err.instancePath || '(root)'} ${err.message ?? 'is invalid'}`,
        );
      }
    }
    if (entry.needs?.some((k) => loadedContent[k] === undefined)) continue;
    const loaded = entry.load(data, loadedContent);
    if (loaded.ok) {
      (loadedContent as Record<string, unknown>)[entry.key] = loaded.value;
    } else {
      for (const message of loaded.errors) {
        problems.push(`${label}: loader: ${message}`);
      }
    }
  }
  return problems;
}
