import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const sourceDirs = ['core', 'session', 'web'].map((p) =>
  path.join(repoRoot, 'packages', p, 'src'),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/\.(test|spec)\./.test(f));
}

function resourceNames(): string[] {
  const raw = JSON.parse(
    readFileSync(path.join(repoRoot, 'content', 'resources.json'), 'utf8'),
  ) as { resources: { name: string }[] };
  return raw.resources.map((r) => r.name);
}

/** Return the text of every string literal in a source file. */
function stringLiterals(fileName: string, text: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('resource display names do not appear as string literals in source', () => {
  const names = resourceNames();
  expect(names.length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const dir of sourceDirs) {
    for (const file of sourceFiles(dir)) {
      const literals = stringLiterals(file, readFileSync(file, 'utf8'));
      for (const name of names) {
        const re = new RegExp(`(?<![\\w])${escapeRegExp(name)}(?![\\w])`);
        if (literals.some((l) => re.test(l))) {
          offenders.push(
            `${path.relative(repoRoot, file)}: string literal contains resource name "${name}"`,
          );
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});

type NamedGroup = Record<string, { name: string }>;

test('archetype, event and modifier names are not string literals in source', () => {
  const raw = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'content', 'presentation.en.json'),
      'utf8',
    ),
  ) as { archetypes: NamedGroup; events: NamedGroup; modifiers: NamedGroup };
  const names = [raw.archetypes, raw.events, raw.modifiers].flatMap((group) =>
    Object.values(group).map((e) => e.name),
  );
  expect(names.length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const dir of sourceDirs) {
    for (const file of sourceFiles(dir)) {
      const literals = new Set(
        stringLiterals(file, readFileSync(file, 'utf8')),
      );
      for (const name of names) {
        if (literals.has(name)) {
          offenders.push(
            `${path.relative(repoRoot, file)}: string literal "${name}" is a display name from the presentation file`,
          );
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});
