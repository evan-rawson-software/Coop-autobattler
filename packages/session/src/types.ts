/**
 * Run state, intents, effects and the injected dependencies (W2-1).
 *
 * Everything in `RunState` is plain JSON so a run can be saved, replayed and
 * checked. See packages/session/README.md for the step machine.
 */
import type {
  AnyReason,
  Battle,
  Cell,
  ConduitReason,
  Content,
  EconomyConfig,
  EventsConfig,
  GhostBucket,
  GhostSnapshot,
  Json,
  MapgenConfig,
  Rng,
  RewardsConfig,
  TeamState,
} from '@game/core';

export type { Json };

// ---------------------------------------------------------------------------
// Steps

export const STEPS = [
  'core_placement',
  'build',
  'pve_choice',
  'pve_battle',
  'pve_summary',
  'event_choice',
  'event_resolve',
  'shop',
  'pvp_battle',
  'pvp_summary',
  'run_over',
] as const;

export type Step = (typeof STEPS)[number];

/**
 * The format of `RunState`. Version 2 added the required `upcomingPve` and
 * changed the battle detail; version 3 made the Workshop per-player and
 * dependent on gold (a version-2 save mid-Workshop could not be finished);
 * version 4 added the ghost fields `pvpOpponent` and `ghostsFought` (W3-1);
 * version 5 is the per-player design (issue #124: `cores` in place of `core`, and an
 * `owner` on every conduit); version 6 lets a conduit end in the team state be a
 * border spot (halves of border links, PP-4); version 7 has no Core vote; version 8
 * stores PvE threats with one Core per plot (`stronghold.cores`, PP-14); version 8 had one shared ID counter for conduits and buildings, version 9 gives each player their own conduit ID space (`nextConduitId`, issue #38). Older states are not readable.
 */
export const RUN_STATE_FORMAT_VERSION = 9;

/**
 * Steps a saved state can never be in. `pve_battle` and `pvp_battle` are
 * entered and left inside one intent (the battle is resolved before anything
 * is revealed), so they never appear in a state that `applyIntent` returns.
 */
export const TRANSIENT_STEPS: readonly Step[] = ['pve_battle', 'pvp_battle'];

/** Which battle the current stretch of the round leads up to or follows. */
export type Leg = 'pve' | 'pvp';

// ---------------------------------------------------------------------------
// Rules and run state

/** Plain data: the numbers the step machine itself needs. */
export interface RunRules {
  /** Lives at the start of a run (RS-7). */
  readonly startingLives: number;
  /** Lives a PvP loss costs (RS-5). A PvE loss never costs a life (RS-3a). */
  readonly pvpLossLifeCost: number;
}

export const MAX_PLAYERS = 4;

export interface PlayerInfo {
  readonly index: number;
  readonly name: string;
}

export interface PlayerRunState {
  readonly gold: number;
  readonly ready: boolean;
  /** This player's shop offers. Opaque; owned by W2-2. */
  readonly shop: Json;
}

export type VoteTopic = 'pve' | 'event';

/**
 * The open votes of the current step. `choices[i]` is player i's current
 * choice or null. For `pve` and `event` it is the string `id` of one of the options in `pending.options`.
 */
export interface OpenVote {
  readonly topic: VoteTopic;
  readonly choices: readonly (Json | null)[];
}

export type OpponentKind = 'pve' | 'ghost' | 'boss';

export interface Opponent {
  readonly kind: OpponentKind;
  readonly label: string;
}

export interface BattleResult {
  readonly won: boolean;
  readonly opponent: Opponent;
  /** Whatever the battle implementation wants kept (seed, event log, ...). */
  readonly detail: Json;
}

/**
 * The PvE options for the battle that comes next, drawn and stored before
 * the shop (or first build step) that leads up to it (RS-6a). Moved into
 * `pending.options` when `pve_choice` opens. `round` is the round of that
 * battle.
 */
export interface UpcomingPve {
  readonly round: number;
  readonly options: readonly Json[];
}

/**
 * The PvP opponent chosen for the coming PvP battle (W3-1), fixed before the
 * battle is revealed. For a ghost the whole validated snapshot is stored, so
 * nothing outside the run state is consulted again; for the boss `ghost` is
 * null and the battle generates the boss from the battle stream as before.
 */
export interface PvpOpponentChoice {
  /** The round of that battle. */
  readonly round: number;
  readonly kind: 'ghost' | 'boss';
  /** The ghost owner's label, or `the boss`. */
  readonly label: string;
  readonly ghost: GhostSnapshot | null;
}

export interface PveRecord {
  readonly difficulty: string;
  readonly won: boolean;
  readonly opponent: Opponent;
  /**
   * Gold each player was paid for this battle. Set when the summary is left
   * (so absent while the summary is open, and in older saves). Additive:
   * no format version change.
   */
  readonly goldPaid?: number;
}

export interface PvpRecord {
  readonly won: boolean;
  readonly opponent: Opponent;
}

/** What was fought in a round. Null for a battle that was never fought. */
export interface RoundRecord {
  readonly round: number;
  readonly pve: PveRecord | null;
  readonly pvp: PvpRecord | null;
}

export interface LoggedAction {
  readonly n: number;
  readonly player: number;
  readonly intent: Json;
}

export interface RunOutcome {
  readonly reason: 'defeated' | 'abandoned';
  readonly round: number;
}

export interface RunState {
  readonly runId: string;
  readonly runVersion: string;
  /** `RUN_STATE_FORMAT_VERSION`; a state of another version is rejected. */
  readonly formatVersion: 9;
  readonly seed: number;
  /** The saved state of the run's `Rng`. */
  readonly rng: readonly [number, number, number, number];
  /** Accepted intents so far; equals `actionLog.length`. */
  readonly actionCounter: number;
  readonly players: readonly PlayerInfo[];
  readonly host: number;
  readonly round: number;
  readonly step: Step;
  readonly leg: Leg;
  readonly lives: number;
  readonly team: TeamState;
  /** Parallel to `players`. */
  readonly perPlayer: readonly PlayerRunState[];
  readonly votes: OpenVote | null;
  /**
   * The options of the next PvE battle (RS-6a): set on entering the first
   * `build` step and on entering the shop that ends a round; cleared when
   * `pve_choice` opens (they are then in `pending.options`).
   */
  readonly upcomingPve: UpcomingPve | null;
  /**
   * W3-1: the opponent of the coming PvP battle. Null until `select_ghost`
   * has been applied in the shop of the PvE leg (and always null with ghosts
   * switched off); set to null again when the PvP battle is fought.
   */
  readonly pvpOpponent: PvpOpponentChoice | null;
  /** W3-1: `ghostKey` of every ghost fought in this run, in order. */
  readonly ghostsFought: readonly string[];
  /** Step-specific data, opaque to everything but the step's owner. */
  readonly pending: Json;
  /** One entry per finished round (and the unfinished one at run end). */
  readonly history: readonly RoundRecord[];
  /** The battles fought so far in the current round. */
  readonly thisRound: {
    readonly pve: PveRecord | null;
    readonly pvp: PvpRecord | null;
  };
  readonly actionLog: readonly LoggedAction[];
  readonly outcome: RunOutcome | null;
}

// ---------------------------------------------------------------------------
// Intents

export type BoardIntent =
  | {
      readonly type: 'place_building';
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
    }
  | {
      readonly type: 'move_building';
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
    }
  | { readonly type: 'return_building'; readonly id: number }
  | {
      readonly type: 'add_conduit';
      readonly from: IntentConduitEnd;
      readonly to: IntentConduitEnd;
      readonly cells: readonly Cell[];
      /** Re-add under this earlier ID (undo); see `addConduit`. */
      readonly id?: number;
    }
  | {
      readonly type: 'erase_conduit';
      readonly id: number;
      /** Hand the newest ID back (undo of an add); see `eraseConduit`. */
      readonly reclaimId?: boolean;
    };

/** A conduit end in an intent: a building side, or a border spot (PP-4). */
export type IntentConduitEnd =
  | { readonly building: number; readonly side: string }
  | { readonly border: number; readonly y: number };

export type BuiltinIntent =
  | { readonly type: 'place_core'; readonly x: number; readonly y: number }
  | { readonly type: 'vote'; readonly choice: Json }
  | { readonly type: 'ready' }
  | { readonly type: 'unready' }
  | { readonly type: 'abandon' }
  | BoardIntent;

export type BuiltinIntentType = BuiltinIntent['type'];

/** An intent owned by a later issue; handled through `deps.handlers`. */
export interface ExtensionIntent {
  readonly type: string;
  readonly [key: string]: Json | undefined;
}

export type Intent = BuiltinIntent | ExtensionIntent;

export const BUILTIN_INTENT_TYPES: readonly BuiltinIntentType[] = [
  'place_core',
  'vote',
  'ready',
  'unready',
  'abandon',
  'place_building',
  'move_building',
  'return_building',
  'add_conduit',
  'erase_conduit',
];

// ---------------------------------------------------------------------------
// Results and effects

export type BuiltinReason =
  | 'wrong_step'
  | 'not_a_player'
  | 'not_host'
  | 'already_ready'
  | 'not_ready'
  | 'locked_ready'
  | 'sealed_producer'
  | 'invalid_intent'
  | 'invalid_choice'
  | 'unknown_intent'
  | AnyReason
  | ConduitReason
  | 'unknown_conduit'
  | 'unknown_building';

/** Built-in reasons, plus whatever an extension handler reports. */
export type RejectReason = BuiltinReason | (string & Record<never, never>);

export type Effect =
  | {
      readonly type: 'step_changed';
      readonly from: Step;
      readonly to: Step;
      readonly round: number;
    }
  | {
      readonly type: 'core_placed';
      readonly player: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'vote_changed'; readonly player: number }
  | {
      readonly type: 'vote_resolved';
      readonly topic: VoteTopic;
      readonly choice: Json;
      /** Every player's vote, in player order (one ticket each). */
      readonly tickets?: readonly Json[];
      /**
       * Present when the votes were not unanimous: the player whose vote was
       * picked at random (each ticket equally likely).
       */
      readonly picked?: { readonly player: number; readonly random: true };
    }
  | {
      readonly type: 'ready_changed';
      readonly player: number;
      readonly ready: boolean;
    }
  | {
      readonly type: 'battle_resolved';
      readonly kind: 'pve' | 'pvp';
      readonly won: boolean;
      readonly opponent: Opponent;
    }
  | { readonly type: 'life_lost'; readonly lives: number }
  /**
   * W3-1 (only with `deps.ghosts`): the shop of the PvE leg was entered; the
   * run controller reads the pool for `bucket` and applies `select_ghost`.
   */
  | {
      readonly type: 'ghost_selection_needed';
      readonly round: number;
      readonly bucket: GhostBucket;
    }
  /** W3-1: `select_ghost` was applied; the opponent is now fixed. */
  | {
      readonly type: 'ghost_selected';
      readonly round: number;
      readonly kind: 'ghost' | 'boss';
      readonly label: string;
      /** How many candidates were eligible and valid. */
      readonly candidates: number;
    }
  /**
   * W3-1: a PvP battle is starting. The snapshot is derived from the state at
   * that moment; the run controller writes it to the ghost store after the
   * save succeeds. `applyIntent` and `replayRun` never touch a store.
   */
  | { readonly type: 'ghost_snapshot'; readonly snapshot: GhostSnapshot }
  | { readonly type: 'round_started'; readonly round: number }
  | {
      readonly type: 'run_over';
      readonly reason: 'defeated' | 'abandoned';
      readonly round: number;
    }
  | {
      readonly type: 'custom';
      readonly name: string;
      readonly data: Json;
    };

export type IntentResult =
  | {
      readonly ok: true;
      readonly state: RunState;
      readonly effects: readonly Effect[];
    }
  | {
      readonly ok: false;
      readonly reason: RejectReason;
      readonly detail?: string;
    };

// ---------------------------------------------------------------------------
// Dependencies

/** Changes a hook may make to the run. Everything else is the machine's. */
export interface StatePatch {
  readonly team?: TeamState;
  readonly perPlayer?: readonly PlayerRunState[];
}

export interface BattleInput {
  readonly kind: 'pve' | 'pvp';
  readonly state: RunState;
  readonly rng: Rng;
  /** For PvE, the option the party voted for; null for PvP. */
  readonly option: Json | null;
}

export interface BattleResolver {
  resolve(input: BattleInput): BattleResult;
  /**
   * Optional: re-create the latest battle (the one in `pending.battle`) from
   * the stored `detail`, for playback. See `replayLastBattle`.
   */
  replay?(state: RunState): ReplayBattleResult;
}

/** What `BattleResolver.replay` returns; see `replayLastBattle`. */
export type ReplayBattleResult =
  | {
      readonly ok: true;
      /** The battle at tick 0; call `step()` until `isOver()`. */
      readonly battle: Battle;
      /** The summary stored when the battle was resolved. */
      readonly stored: Json;
      /** The event-log hash stored when the battle was resolved. */
      readonly storedEventLogHash: string;
    }
  | { readonly ok: false; readonly reason: string };

export interface RunHooks {
  /** W2-2: add the starting buildings and gold (entering `build`). */
  startingKit(state: RunState, rng: Rng): StatePatch;
  /**
   * W2-3: the options for the PvE battle of round `round` (the current round
   * on entering the first `build`, the next one on entering the shop that
   * ends a round); each has a string `id`.
   */
  pveOptions(state: RunState, rng: Rng, round: number): readonly Json[];
  /** W2-3: three event offers; each has a string `id`. */
  eventOffers(state: RunState, rng: Rng): readonly Json[];
  /**
   * W2-3: apply the chosen event offer. `followUp` non-null means the event
   * needs a further choice: the step becomes `event_resolve` with
   * `pending = {offer, followUp}` until an extension handler advances it.
   */
  resolveEvent(
    state: RunState,
    offer: Json,
    rng: Rng,
  ): { readonly patch: StatePatch; readonly followUp: Json | null };
  /** W2-2: roll offers and pay base income (entering `shop`). */
  onShopEnter(state: RunState, rng: Rng): StatePatch;
  /** W2-3: gold for wins, consolation gold (leaving a battle summary). */
  rewards(
    state: RunState,
    battle: BattleResult & { readonly kind: 'pve' | 'pvp' },
  ): StatePatch;
}

export interface HandlerContext {
  readonly state: RunState;
  readonly player: number;
  readonly intent: ExtensionIntent;
  readonly deps: RunDeps;
  /**
   * True only while `replayRun` re-applies a logged action. A handler that
   * logs a normalised form of its intent (`HandlerResult.logged`) must accept
   * exactly that form here and only here; live it must reject it.
   */
  readonly replay?: boolean;
}

export type HandlerResult =
  | {
      readonly ok: true;
      readonly state: RunState;
      readonly effects?: readonly Effect[];
      /** True when the handler completed the current step. */
      readonly advance?: boolean;
      /**
       * What the machine writes to the action log instead of the intent as
       * received (a normalisation that keeps the log small). `replayRun`
       * feeds exactly this back to the handler with `replay: true`.
       */
      readonly logged?: Json;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail?: string;
    };

/**
 * A handler for one extension intent type. It returns the new state; the
 * machine then does the action-log bookkeeping. Use `drawStream` for
 * randomness.
 */
export interface IntentHandler {
  /** The steps in which this intent is legal; elsewhere it is `wrong_step`. */
  readonly steps: readonly Step[];
  /** True if only the host may send it (`not_host` for anyone else). */
  readonly hostOnly?: boolean;
  handle(ctx: HandlerContext): HandlerResult;
}

/**
 * Switches the ghost pool on (W3-1). Absent: PvP always fights the generated
 * boss, `select_ghost` is unknown and no snapshot effect is emitted.
 */
export interface GhostRules {
  /** The stable identifier written into every snapshot of this install. */
  readonly ownerId: string;
  /**
   * What opponents see instead of the player names (a front end that does not
   * want to show them). Absent: the names of the party.
   */
  readonly ownerLabel?: string;
  /** For the value bound and the modifier checks of `validateGhostSnapshot`. */
  readonly economy: EconomyConfig;
  readonly events: EventsConfig;
}

export interface RunDeps {
  readonly content: Content;
  readonly mapgenConfig: MapgenConfig;
  readonly rules: RunRules;
  readonly battle: BattleResolver;
  readonly hooks: RunHooks;
  /** Extension intents, keyed by intent type. */
  readonly handlers: Readonly<Record<string, IntentHandler>>;
  /** The configured rewards, when wired (`createGameDeps`); for selectors. */
  readonly rewards?: RewardsConfig;
  /** W3-1: present when the ghost pool is in use. */
  readonly ghosts?: GhostRules;
}

export interface CreateRunArgs {
  readonly runId: string;
  readonly runVersion: string;
  readonly seed: number;
  /** Player names, 1 to 4; the index in this array is the player index. */
  readonly players: readonly string[];
  readonly host: number;
}
