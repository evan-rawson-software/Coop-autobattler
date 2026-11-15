import { describe, expect, test } from 'vitest';
import { barLivesText } from './bar-lives.js';

const lost = { battle: { won: false } };
describe('barLivesText', () => {
  test('a lost rival summary shows the life already taken', () => {
    expect(
      barLivesText({ step: 'pvp_summary', lives: 5, pending: lost }, 1, 5),
    ).toBe('Lives 4 / 5 (−1)');
  });
  test('a win, other steps, and no life left', () => {
    const won = { battle: { won: true } };
    expect(
      barLivesText({ step: 'pvp_summary', lives: 5, pending: won }, 1, 5),
    ).toBe('Lives 5 / 5');
    expect(barLivesText({ step: 'shop', lives: 5, pending: lost }, 1, 5)).toBe(
      'Lives 5 / 5',
    );
    expect(
      barLivesText({ step: 'pvp_summary', lives: 1, pending: lost }, 1, 5),
    ).toBe('Lives 0 / 5 (−1)');
    expect(
      barLivesText({ step: 'pvp_summary', lives: 5, pending: null }, 1, 5),
    ).toBe('Lives 5 / 5');
  });
  test('while the result card is not open the bar shows the lives before the battle', () => {
    expect(
      barLivesText(
        { step: 'pvp_summary', lives: 5, pending: lost },
        1,
        5,
        false,
      ),
    ).toBe('Lives 5 / 5');
    expect(
      barLivesText(
        { step: 'pvp_summary', lives: 5, pending: lost },
        1,
        5,
        true,
      ),
    ).toBe('Lives 4 / 5 (−1)');
  });
});
