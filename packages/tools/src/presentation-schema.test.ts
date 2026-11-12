import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { SCREEN_TEXT_SLOTS } from '@game/core';
import { rawPresentationEn } from '@game/content';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const schema = JSON.parse(
  readFileSync(path.join(repoRoot, 'schemas/presentation.schema.json'), 'utf8'),
) as object;
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(
  schema,
);
const copy = (): { templates: { screens: Record<string, string> } } =>
  JSON.parse(JSON.stringify(rawPresentationEn)) as never;

describe('templates.screens in the schema', () => {
  test('the shipped file is valid', () => {
    expect(validate(rawPresentationEn)).toBe(true);
  });

  test('the schema lists exactly the keys the loader requires', () => {
    const props = (
      schema as {
        properties: {
          templates: {
            properties: { screens: { properties: object; required: string[] } };
          };
        };
      }
    ).properties.templates.properties.screens;
    const keys = Object.keys(SCREEN_TEXT_SLOTS).sort();
    expect(Object.keys(props.properties).sort()).toEqual(keys);
    expect([...props.required].sort()).toEqual(keys);
  });

  test('a missing or misspelt key fails validation', () => {
    const missing = copy();
    delete missing.templates.screens['collects'];
    expect(validate(missing)).toBe(false);
    const misspelt = copy();
    misspelt.templates.screens['colects'] = 'x';
    expect(validate(misspelt)).toBe(false);
  });
});
