import type { VNode } from 'preact';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import type { WebContent } from '../content.js';
import { linkText, type HalfStatus } from './border-links.js';
import { BuildSession } from './session.js';
import { ProblemsPanel } from './panels.js';
import { rateText } from './rates.js';
import { playerName, screenText, screenTexts } from './texts.js';
import { deriveProblems, type FlowView } from './view-model.js';

// Rate, supply and link texts come from the presentation file (issue #142).

const withScreens = (over: Record<string, string>): WebContent => ({
  ...content,
  presentation: {
    ...content.presentation,
    templates: {
      ...content.presentation.templates,
      screens: { ...content.presentation.templates.screens, ...over },
    },
  },
});

describe('texts come from the presentation file', () => {
  test('the shop rate line follows the template', () => {
    const def = content.buildings.get('bld_extractor');
    if (def === undefined) throw new Error('no extractor');
    const texts = { ...screenTexts, collects: 'Mines {rate} per s' };
    expect(rateText(def, 1, 20, texts)).toMatch(/^Mines \d+\.\d\d per s$/);
    expect(rateText(def, 1, 20)).toMatch(/^Collects \d+\.\d\d \/ s$/);
  });

  test('the link state follows the template', () => {
    const h = {
      kind: 'send',
      state: 'open',
      owner: 0,
      neighbour: null,
    } as unknown as HalfStatus;
    const texts = { ...screenTexts, linkOpen: 'Waiting ({verb})' };
    expect(linkText(h, String, texts)).toBe('Waiting (sending)');
  });

  test('fallback player name is a template', () => {
    expect(playerName(screenTexts, ['Ann'], 0)).toBe('Ann');
    expect(playerName(screenTexts, ['Ann'], 1)).toBe('Player 2');
    expect(playerName({ playerFallback: 'Seat {number}' }, [], 2)).toBe(
      'Seat 3',
    );
    expect(screenText({}, 'missing')).toBe('');
  });

  test('the problems list reads supply and partner lines from the file', async () => {
    const mk = (id: number, owner: number) => ({
      id,
      def: 'bld_barracks',
      owner,
      x: id * 4,
      y: 0,
      rotation: 0,
      tier: 1,
    });
    const s = await BuildSession.start(7, Date.now, ['Ann', 'Bo']);
    const team = {
      ...s.run.team,
      stash: [],
      buildings: [mk(1, 0), mk(2, 1)],
    } as unknown as typeof s.run.team;
    const flow = {
      dry: { consumers: [], sources: [] },
      starved: new Set<number>(),
      supply: [1, 2].map((building) => ({
        building,
        state: 'under',
        gets: 10,
        needs: 50,
      })),
    } as unknown as FlowView;
    const scope = { acting: 0, names: ['Ann'] };
    const text = (c: WebContent): string[] =>
      deriveProblems(team, c, flow, scope)
        .filter((p) => p.kind === 'under_supplied')
        .map((p) => p.text);
    const [own, partner] = text(content);
    expect(own).toContain('gets 0.10/s of the 0.50/s it needs.');
    expect(partner).toBe('Player 2 has 1 under-supplied building.');
    const edited = text(
      withScreens({
        problemUnderSupplied: '{name}: {gets} of {needs}',
        partnerUnderSuppliedOne: '{player} is short by one.',
      }),
    );
    expect(edited[0]).toMatch(/: 0\.10 of 0\.50$/);
    expect(edited[1]).toBe('Player 2 is short by one.');
  });
});

describe('ProblemsPanel', () => {
  function walk(n: unknown, out: VNode[] = []): VNode[] {
    if (Array.isArray(n)) n.forEach((x) => walk(x, out));
    else if (typeof n === 'object' && n !== null && 'props' in n) {
      out.push(n as VNode);
      walk((n as VNode<{ children?: unknown }>).props.children, out);
    }
    return out;
  }

  test('a line with nothing to jump to is plain text, not a button', () => {
    const nodes = walk(
      ProblemsPanel({
        problems: [
          {
            id: 'under-partner:1',
            kind: 'under_supplied',
            text: 'Bo has 2 under-supplied buildings.',
            focus: null,
            building: null,
          },
          {
            id: 'under:3',
            kind: 'under_supplied',
            text: 'x',
            focus: { x: 1, y: 1 },
            building: 3,
          },
        ],
        onPick: () => undefined,
      }),
    );
    expect(nodes.filter((n) => n.type === 'button')).toHaveLength(1);
    const plain = nodes.filter(
      (n) =>
        n.type === 'span' &&
        (n.props as Record<string, unknown>)['class'] === 'problem',
    );
    expect(plain).toHaveLength(1);
  });
});
