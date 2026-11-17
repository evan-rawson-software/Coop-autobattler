import { describe, expect, test } from 'vitest';
import { content, mapgen as config } from './testing/support.js';
import specialistsJson from '../../../content/specialists.json';
import { generateMap } from './generate-map.js';
import { canonicalJson, hashJson } from './hash.js';
import { loadSpecialists } from './specialists.js';
import {
  createTeamState,
  setSpecialist,
  specialistOf,
  validateTeamState,
  type TeamState,
} from './team-state.js';
import { runTeamStateOps } from './team-state-ops.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function got<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}
const ROSTER = content.specialists.ids();

function freshTeam(partySize = 2): TeamState {
  return createTeamState(generateMap(5, partySize, content, config));
}

describe('content/specialists.json (CB-51)', () => {
  test('holds the four specialists of issue #468, in order', () => {
    expect(ROSTER).toEqual([
      'spec_flowmancer',
      'spec_wardsmith',
      'spec_beastbinder',
      'spec_alchemist',
    ]);
    const byFamily = content.specialists.specialists.map((d) => d.family);
    expect(byFamily).toEqual(['logistics', 'defense', 'units', 'industry']);
    const sigs = content.specialists.specialists.map((d) => d.signature);
    expect(sigs).toEqual([
      'bld_mana_well',
      'bld_rune_ward',
      'bld_familiar_roost',
      'bld_transmuter',
    ]);
  });

  test('the bonus numbers are the umbrella ones (CB-51a)', () => {
    const eff = (id: string) => content.specialists.get(id)?.effects;
    expect(eff('spec_flowmancer')).toEqual([
      { kind: 'source_speed_percent', percent: 10 },
    ]);
    expect(eff('spec_wardsmith')).toEqual(
      ['wall', 'gate', 'turret'].map((target) => ({
        kind: 'building_health_percent',
        target,
        percent: 15,
      })),
    );
    expect(eff('spec_beastbinder')).toEqual([
      { kind: 'unit_health_percent', percent: 10 },
    ]);
    expect(eff('spec_alchemist')).toEqual([
      { kind: 'production_speed_percent', percent: 15 },
    ]);
  });

  test('every specialist has display text', () => {
    for (const id of ROSTER) {
      const e = content.presentation.specialist(id);
      expect(e?.name, id).toBeTruthy();
      expect(e?.family, id).toBeTruthy();
      expect(e?.bonus, id).toBeTruthy();
      expect(e?.signature, id).toBeTruthy();
      expect(e?.description, id).toBeTruthy();
    }
    expect(content.presentation.specialist('spec_nope')).toBeUndefined();
  });
});

describe('the loader and its bounds', () => {
  const load = (mutate: (d: Record<string, unknown>) => void) => {
    const d = clone(specialistsJson) as unknown as Record<string, unknown>;
    mutate(d);
    return loadSpecialists(d);
  };
  const list = (d: Record<string, unknown>) =>
    d['specialists'] as Record<string, unknown>[];
  const errors = (r: ReturnType<typeof loadSpecialists>): string =>
    r.ok ? '' : r.errors.join('\n');

  test('the shipped file loads', () => {
    expect(loadSpecialists(specialistsJson).ok).toBe(true);
  });

  test('refuses a file of the wrong shape', () => {
    for (const bad of [null, 5, [], {}, { specialists: 'x' }]) {
      expect(loadSpecialists(bad).ok).toBe(false);
    }
    expect(errors(load((d) => (d['extra'] = 1)))).toMatch(/unknown field/);
    expect(errors(load((d) => (d['specialists'] = [])))).toMatch(/1 to 16/);
  });

  test('refuses a bad id, a duplicate id and a duplicate signature building', () => {
    expect(errors(load((d) => (got(list(d)[0])['id'] = 'flow')))).toMatch(
      /spec_/,
    );
    expect(
      errors(load((d) => (got(list(d)[1])['id'] = got(list(d)[0])['id']))),
    ).toMatch(/duplicate id/);
    expect(
      errors(
        load(
          (d) => (got(list(d)[1])['signature'] = got(list(d)[0])['signature']),
        ),
      ),
    ).toMatch(/duplicate signature/);
    expect(
      errors(load((d) => (got(list(d)[0])['signature'] = 'mana'))),
    ).toMatch(/signature/);
    expect(
      errors(load((d) => (got(list(d)[0])['id'] = `spec_${'a'.repeat(60)}`))),
    ).toMatch(/at most 48/);
  });

  test('refuses an unknown family, a bad effect and out-of-bound percents', () => {
    expect(errors(load((d) => (got(list(d)[0])['family'] = 'magic')))).toMatch(
      /family/,
    );
    expect(errors(load((d) => (got(list(d)[0])['effects'] = [])))).toMatch(
      /1 to 4/,
    );
    const eff = (d: Record<string, unknown>) =>
      got((got(list(d)[0])['effects'] as Record<string, unknown>[])[0]);
    expect(errors(load((d) => (eff(d)['kind'] = 'unit_speed')))).toMatch(
      /kind/,
    );
    expect(errors(load((d) => (eff(d)['percent'] = 0)))).toMatch(/percent/);
    expect(errors(load((d) => (eff(d)['percent'] = 101)))).toMatch(
      /at most 100/,
    );
    expect(errors(load((d) => (eff(d)['percent'] = 1.5)))).toMatch(/percent/);
    expect(errors(load((d) => (eff(d)['target'] = 'wall')))).toMatch(
      /unknown field/,
    );
    const ward = (d: Record<string, unknown>) =>
      got((got(list(d)[1])['effects'] as Record<string, unknown>[])[0]);
    expect(errors(load((d) => (ward(d)['target'] = 'moat')))).toMatch(/target/);
    expect(errors(load((d) => delete ward(d)['target']))).toMatch(/target/);
  });

  test('refuses more than 16 specialists', () => {
    const r = load((d) => {
      const base = got(list(d)[0]);
      d['specialists'] = Array.from({ length: 17 }, (_, i) => ({
        ...base,
        id: `spec_s${String(i)}`,
        signature: `bld_s${String(i)}`,
      }));
    });
    expect(errors(r)).toMatch(/1 to 16/);
  });
});

describe('a player picks a specialist in the team state (CP-31)', () => {
  test('a fresh team has none, and the field is omitted', () => {
    const t = freshTeam();
    expect(t.specialists).toBeUndefined();
    expect(specialistOf(t, 0)).toBeNull();
    expect(Object.keys(t)).not.toContain('specialists');
  });

  test('setSpecialist sets and changes one player without touching the others', () => {
    const t = freshTeam(3);
    const a = setSpecialist(t, content, 1, ROSTER[2] as string);
    if (!a.ok) throw new Error(a.reason);
    expect(a.state.specialists).toEqual([null, ROSTER[2], null]);
    const b = setSpecialist(a.state, content, 1, ROSTER[0] as string);
    if (!b.ok) throw new Error(b.reason);
    expect(b.state.specialists).toEqual([null, ROSTER[0], null]);
    expect(specialistOf(b.state, 1)).toBe(ROSTER[0]);
    expect(specialistOf(b.state, 0)).toBeNull();
    // The input is not changed.
    expect(a.state.specialists).toEqual([null, ROSTER[2], null]);
    // The rest of the state is shared.
    expect(b.state.buildings).toBe(t.buildings);
  });

  test('setting null for the last pick drops the field again', () => {
    const t = freshTeam(2);
    const a = setSpecialist(t, content, 0, ROSTER[0] as string);
    if (!a.ok) throw new Error(a.reason);
    const b = setSpecialist(a.state, content, 0, null);
    if (!b.ok) throw new Error(b.reason);
    expect(b.state).toEqual(t);
    expect(Object.keys(b.state)).not.toContain('specialists');
  });

  test('refuses an unknown specialist and a player outside the party', () => {
    const t = freshTeam(2);
    expect(setSpecialist(t, content, 0, 'spec_nope')).toMatchObject({
      ok: false,
      reason: 'unknown_specialist',
    });
    for (const p of [-1, 2, 0.5, Number.NaN]) {
      expect(setSpecialist(t, content, p, ROSTER[0] as string)).toMatchObject({
        ok: false,
        reason: 'invalid_owner',
      });
    }
  });

  test('a team without the field hashes as before: the field changes the hash only when set', () => {
    const t = freshTeam(2);
    const a = setSpecialist(t, content, 0, ROSTER[0] as string);
    if (!a.ok) throw new Error(a.reason);
    expect(hashJson(JSON.parse(canonicalJson(t)))).not.toEqual(
      hashJson(JSON.parse(canonicalJson(a.state))),
    );
    expect(canonicalJson(t)).not.toContain('specialists');
  });

  test('the golden op script `setSpecialist` runs through runTeamStateOps', () => {
    const out = runTeamStateOps(
      {
        seed: 5,
        partySize: 2,
        ops: [
          { op: 'setSpecialist', actor: 0, specialist: 'spec_wardsmith' },
          { op: 'setSpecialist', actor: 1, specialist: 'spec_nope' },
          { op: 'setSpecialist', actor: 5, specialist: 'spec_wardsmith' },
        ],
      },
      content,
      config,
    );
    expect(out.results).toEqual([
      { op: 'setSpecialist', ok: true },
      { op: 'setSpecialist', ok: false, reason: 'unknown_specialist' },
      { op: 'setSpecialist', ok: false, reason: 'invalid_owner' },
    ]);
    expect(out.state.specialists).toEqual([ROSTER[1], null]);
  });
});

describe('validateTeamState and the specialists field', () => {
  const check = (t: unknown) => validateTeamState(t, content, config);
  const withField = (field: unknown): unknown => ({
    ...clone(freshTeam(2)),
    specialists: field,
  });

  test('accepts a state without the field (an old save) and with a valid one', () => {
    expect(check(clone(freshTeam(2))).ok).toBe(true);
    const a = setSpecialist(freshTeam(2), content, 1, ROSTER[3] as string);
    if (!a.ok) throw new Error(a.reason);
    const r = check(clone(a.state));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(a.state);
    expect(check(withField([ROSTER[0], ROSTER[0]])).ok).toBe(true);
    expect(check(withField([null, ROSTER[0]])).ok).toBe(true);
  });

  test('refuses a field of the wrong size, type or content', () => {
    for (const bad of [
      [],
      [ROSTER[0]],
      [ROSTER[0], ROSTER[0], ROSTER[0]],
      'spec_flowmancer',
      {},
      [null, null],
      [7, ROSTER[0]],
      ['', ROSTER[0]],
      ['Spec_Flowmancer', ROSTER[0]],
      ['spec_nope', ROSTER[0]],
      ['bld_extractor', ROSTER[0]],
      [undefined, ROSTER[0]],
    ]) {
      const r = check(withField(bad));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(check(withField(null)).ok).toBe(false);
  });
});
