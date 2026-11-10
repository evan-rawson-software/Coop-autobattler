/**
 * Board files: a reference board (or any team) stored as JSON.
 *
 * Format: `{ "name": string, "description": string, "mapSeed": number,
 * "partySize": number, "team": <team state, schemas/team-state.schema.json> }`.
 * A bare team state (an object with a `map`) is accepted too.
 */
import {
  validateTeamState,
  type AnyReferenceBoardName,
  type TeamState,
} from '@game/core';
import { CliError } from './args.js';
import type { SimContext } from './context.js';

export interface BoardFile {
  readonly name: string;
  readonly description: string;
  readonly mapSeed: number;
  readonly partySize: number;
  readonly team: TeamState;
}

export interface Board {
  readonly label: string;
  readonly team: TeamState;
}

export const BOARD_DESCRIPTIONS: Readonly<
  Record<AnyReferenceBoardName, string>
> = {
  rush: 'Three tier 1 extractors, each feeding a tier 1 barracks directly. Nothing else.',
  fortify:
    'Walls around the Core, three tier 2 turrets each powered by its own tier 2 extractor, one barracks and one armory.',
  siege:
    'Heavy and slow: tier 3 extractors feed two tier 3 barracks and a tier 3 armory behind a tier 2 wall screen.',
  poor: 'The starting kit placed badly: a far-away barracks, an unconnected extractor, an unpowered turret, walls in a corner.',
};

export function boardFileOf(
  name: AnyReferenceBoardName,
  mapSeed: number,
  team: TeamState,
): BoardFile {
  return {
    name,
    description: BOARD_DESCRIPTIONS[name],
    mapSeed,
    partySize: team.map.partySize,
    team,
  };
}

/** The exact text written to `boards/<name>.json`. */
export function boardFileText(file: BoardFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Parse and validate a board file's JSON text. `where` names the file in
 * error messages. Throws `CliError` with every problem found.
 */
export function parseBoardText(
  text: string,
  where: string,
  ctx: SimContext,
): Board {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CliError(
      `${where}: not valid JSON (${e instanceof Error ? e.message : 'parse error'}).`,
    );
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CliError(`${where}: expected a JSON object.`);
  }
  const rec = data as Record<string, unknown>;
  const teamData = 'team' in rec ? rec['team'] : rec;
  const result = validateTeamState(teamData, ctx.content, ctx.mapgen);
  if (!result.ok) {
    throw new CliError(
      `${where}: not a valid team state:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  const name = typeof rec['name'] === 'string' ? rec['name'] : where;
  return { label: name, team: result.state };
}
