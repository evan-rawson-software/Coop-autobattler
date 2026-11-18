# 08 — Audio

Status: Draft v1.0

Design of the game's sound effects and music (issues #445 to #452). It
fixes the tone, every cue, the mix rules, the file formats and the budget, so
the build steps can be coded from it and the Godot port can reuse the same
files. Numbers marked [PROPOSED] are placeholders to be tuned in the mix pass
(#452). Rule IDs are `AU-n`.

## Principles

- **AU-1 [DECIDED]** (#445) Audio is **presentation only**. It reads the run
  state and the arena event log. It never changes the simulation, saves,
  replays, golden vectors or bundled ghosts.
- **AU-2 [DECIDED]** (#445) Audio is **never the only signal.** Everything a
  sound announces is also visible. Nothing is added for players who cannot
  hear (MVP).
- **AU-3 [DECIDED]** (#445) **Data, not code.** Which moment plays which cue,
  and the sound parameters, are content files with schemas. The Godot port
  reads the same files (AU-40).
- **AU-4 [DECIDED]** (#445) Effects are **generated in code** (sfxr-style
  synthesis, `packages/audio`), like the sprites. No recorded audio, no
  licences. A sound can later be replaced by a recorded file with the same
  sound ID.
- **AU-5 [DECIDED]** (#445) Music is **simple placeholder loops** (calm for
  building, livelier for battle, crossfaded) and short win and loss
  stingers. No adaptive music, voice or panning.
- **AU-6 [DECIDED]** (#445) The total download for audio is **2 MB or less**
  (AU-44).
- **AU-7 [DECIDED]** (#445) Players set master, music and effects volume and
  can mute everything. The web build remembers this per browser. The browser
  blocks sound until the first click, so audio starts then (AU-30). Music
  pauses while the tab is hidden (AU-32).

## Tone

- **AU-10 [DECIDED]** (#392, #393) Arcane industry, light and charming. Sound
  follows the art: soft, friendly, readable at a glance.
- **AU-11 [PROPOSED]** Do:
  - soft, rounded timbres: sine, triangle, a low-duty pulse, a short pluck,
    a filtered noise puff;
  - chimes, clicks, small bells, warm thumps, bubbling and ticking
    machinery;
  - short sounds (most under 250 ms) with a quick attack and a soft decay;
  - rising pitch for good news and gain, falling pitch for loss and refusal;
  - a few notes from one scale (AU-45) so overlapping sounds never clash.
- **AU-12 [PROPOSED]** Don't:
  - harsh, bright or distorted sounds, loud noise bursts, sirens, alarms
    or anything above about 6 kHz at full level;
  - gore: no screams, squelches, crunches or bone sounds. A unit dying is a
    small "pop" and a falling blip;
  - punishment: a lost battle or run sounds disappointed, a slow falling
    phrase in a soft timbre, never a buzzer or a fanfare of failure;
  - long sounds that hide the next one (effects stay under 1.2 s, AU-42);
  - sounds that carry meaning only by loudness.

## Groups and settings

- **AU-20 [DECIDED]** There are three groups: `master`, `music` and
  `effects`. `master` scales both of the others. Each cue and track belongs
  to `music` or `effects`.
- **AU-21 [PROPOSED]** Volumes are whole numbers 0 to 100. Defaults:
  `master` 80, `music` 50, `effects` 80. `muted` defaults to false. The gain
  of a sound is `(master / 100)^2 * (group / 100)^2 * cueVolume / 100 *
  duck`, so the slider feels even. When `muted` is true, or the gain is 0,
  nothing is scheduled.
- **AU-22 [PROPOSED]** The web build saves the settings in `localStorage`
  under the key `coop-autobattler:audio` as
  `{"v":1,"master":80,"music":50,"effects":80,"muted":false}`. A missing,
  unreadable or invalid value gives the defaults; a value out of range is
  clamped. The settings are not part of a save, a run or a replay. The
  Godot port keeps the same four values in its settings file (`[audio]`
  section, same names).
- **AU-23 [PROPOSED]** The **Sound settings** panel has three sliders
  (Master, Music, Effects) and a Mute toggle. It opens from the main menu
  ("Sound") and from the in-run Menu, with the same contents (wireframe 5c).
  Changes apply at once, and the panel plays `ui.toggle` on mute and a short
  `ui.click` when a slider is released, so the new level can be heard. The
  texts go in `content/presentation.en.json` (`templates.screens`) when #448
  builds the panel.

## Cue model

- **AU-24 [PROPOSED]** A **cue** is one named moment: a stable ID of the form
  `family.name` (lower case, digits and `_`), for example `shop.buy`.
  Families: `ui`, `build`, `shop`, `run`, `event`, `battle`,
  `music`.
- **AU-25 [PROPOSED]** Each cue has these fields (the same as the columns of
  the tables below):
  - `sound`: the sound ID it plays. For an effect it is the cue ID with `.`
    replaced by `_` (`shop.buy` is `shop_buy`), and the default is that, so
    most cues omit it. A music cue names a track in `content/music.json`.
  - `group`: `effects` or `music`.
  - `priority`: 1 (background), 2 (normal) or 3 (important). Used when the
    voices are full (AU-27) and to pick among cues of one thinning window
    (AU-34).
  - `minGapMs`: the least time between two starts of this cue. A request
    inside the gap is dropped.
  - `maxVoices`: the most plays of this cue sounding at once. A request over
    the limit is dropped.
  - `volume`: 0 to 100, the cue's own level (AU-21).
  - optional `duck`: `{ "gain": 0..1, "holdMs": n }`, what it does to the
    music (AU-35).
  - optional `enabled`: false switches a cue off without removing it (used
    for `ui.hover`).
- **AU-26 [PROPOSED]** A cue plays from a **trigger**: a UI or run moment
  named in the tables (called by the web code with the cue ID), or an arena
  event type with an optional condition, in the `battleMap` of
  `content/audio.json` (AU-41).
- **AU-27 [PROPOSED]** The engine has **16 effect voices** at once. When all
  are busy, a new cue starts only if its priority is higher than the lowest
  priority sounding; it then stops the sounding voice of that priority with
  the least time left. Otherwise it is dropped. Music uses its own two
  voices (the playing track and the one fading in), outside the 16.
- **AU-28 [PROPOSED]** Dropped cues are dropped, not queued: a sound that
  arrives late is worse than none. The only exception is unlocking (AU-30).
- **AU-29 [PROPOSED]** Variation: a cue may list up to three sounds in
  `variants`; they play in turn (round robin per cue), never at random, so
  tests and replays are repeatable.

### Unlocking, tabs and the context

- **AU-30 [DECIDED]** (#445) The audio context is created and resumed on
  the first `pointerdown` or `keydown` on the page. Cues requested before
  that are dropped, except that the music that should be playing at that
  moment starts at unlock.
- **AU-31 [PROPOSED]** Sound files are decoded on first use after unlock
  (or in the background right after it), never at page load. A file that
  fails to load or decode is skipped silently; the game still works.
- **AU-32 [DECIDED]** (#445) While the tab is hidden (`visibilitychange`),
  music pauses (the context is suspended) and effect cues are dropped. They
  resume when the tab is visible again; effects that were due while it was
  hidden are not played afterwards.

## Cue list

Columns: **ID**, the **trigger**, **P**riority (1 to 3), **gap** (`minGapMs`),
**max** (`maxVoices`) and **vol** (`volume`). All are `effects` cues unless
the section says `music`. Every number is [PROPOSED].

### Interface (`ui`)

| ID | Trigger | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- |
| `ui.click` | A button, tab or card is pressed and does nothing special | 2 | 60 | 2 | 60 |
| `ui.hover` | The pointer enters a button (desktop only). `enabled` is false in the first release; the mix pass decides | 1 | 80 | 1 | 25 |
| `ui.confirm` | A choice is made that moves on: Start, Resume, a picked option, Ready in a dialog | 2 | 120 | 1 | 70 |
| `ui.error` | An action is refused (a reason line is shown) and no more specific cue applies | 2 | 150 | 1 | 65 |
| `ui.toggle` | A switch changes: Mute, a checkbox, a setting toggle | 2 | 80 | 1 | 55 |

### Build (`build`)

| ID | Trigger | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- |
| `build.place` | A building or Core is placed on the board | 2 | 80 | 2 | 75 |
| `build.rotate` | The held or selected building is rotated | 1 | 60 | 1 | 50 |
| `build.move` | A placed building is picked up and put down elsewhere (played on the drop, instead of `build.place`) | 2 | 80 | 1 | 65 |
| `build.stash` | A building returns to the inventory (stash) | 2 | 80 | 1 | 60 |
| `build.conduit_draw` | A conduit is finished (the drag ends on a valid cell) | 2 | 80 | 1 | 60 |
| `build.conduit_erase` | A conduit is removed | 2 | 80 | 1 | 55 |
| `build.illegal` | A placement or conduit is refused (red preview released) | 2 | 150 | 1 | 65 |

### Shop (`shop`)

| ID | Trigger | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- |
| `shop.buy` | An item is bought | 2 | 80 | 2 | 80 |
| `shop.sell` | A building is sold | 2 | 80 | 2 | 70 |
| `shop.reroll` | The shop is re-rolled | 2 | 120 | 1 | 65 |
| `shop.no_gold` | A buy or re-roll is refused for lack of gold | 2 | 150 | 1 | 60 |

### Run (`run`) and events (`event`)

| ID | Trigger | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- |
| `run.ready` | This player presses Ready (or Unready: `ui.toggle`) | 2 | 120 | 1 | 65 |
| `run.all_ready` | Everyone is ready and the step ends | 2 | 300 | 1 | 75 |
| `run.vote_cast` | A vote is cast, by this player or another (co-op) | 1 | 100 | 2 | 50 |
| `run.vote_resolved` | A vote resolves and the winning option shows | 2 | 300 | 1 | 70 |
| `run.event_chosen` | An event option is chosen (after the vote, if any) | 2 | 200 | 1 | 70 |
| `run.modifier_gained` | A run modifier is added (a Shrine or a Pact) | 2 | 300 | 1 | 75 |
| `run.life_lost` | A life is lost, when the summary shows it | 3 | 500 | 1 | 75 |
| `run.round_start` | A new round begins (the round number changes) | 2 | 500 | 1 | 65 |
| `run.over` | The run-over screen opens | 3 | 1000 | 1 | 75 |
| `run.new_best` | The run-over screen shows a new record (depth for the party size). Ducks the music | 3 | 1000 | 1 | 80 |
| `event.caravan_turn` | **Reserved** (#415): a Caravan draft passes to the next player. No sound or trigger until #415 is built | 2 | 300 | 1 | 60 |

`run.over` and `music.loss` do not play together: after a lost run the
loss stinger plays at the end of the battle, and `run.over` only when the
screen opens, with the duck of AU-35. After a new best, `run.new_best`
replaces `run.over`.

### Battle (`battle`, `music`)

Every battle cue comes from the arena event log (AU-33 to AU-39). **Ally** is
side 0, the party's side. **Foe** is side 1. A cue marked "thinned" goes
through the windows of AU-34 first; the others are key moments and are never
thinned, only limited by the gap and max below.

| ID | Event (and condition) | Thinned | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- | --- |
| `battle.start` | `zone_revealed` | no | 2 | 1000 | 1 | 70 |
| `battle.unit_spawned_ally` | `unit_spawned`, `side` 0 | spawn | 1 | 100 | 2 | 40 |
| `battle.unit_spawned_foe` | `unit_spawned`, `side` 1 | spawn | 1 | 100 | 2 | 40 |
| `battle.attack` | `unit_attacked`, target a unit or a building | attack | 1 | 120 | 2 | 45 |
| `battle.turret_fired` | `turret_fired` | attack | 1 | 120 | 2 | 45 |
| `battle.splash` | `splash` (the Mortar and splash units) | attack | 1 | 150 | 1 | 50 |
| `battle.ward_struck` | `ward_struck` | attack | 1 | 150 | 1 | 45 |
| `battle.core_hit` | `unit_attacked`, target a Core of side 0, that Core above the low mark | attack | 2 | 200 | 1 | 65 |
| `battle.core_hit_low` | The same, with that Core at or below the low mark (AU-36). Louder and with a lower, slower tone | attack | 3 | 250 | 1 | 85 |
| `battle.foe_core_hit` | `unit_attacked`, target a Core of side 1 | attack | 2 | 200 | 1 | 55 |
| `battle.unit_died` | `unit_died` (a unit of a side; a guard's death has `side` 2 and plays nothing) | death | 1 | 100 | 2 | 40 |
| `battle.building_destroyed` | `building_destroyed`, `side` 1 | no | 2 | 120 | 2 | 65 |
| `battle.building_lost` | `building_destroyed`, `side` 0 | no | 2 | 120 | 2 | 70 |
| `battle.core_destroyed` | `core_destroyed`, `side` 1 | no | 3 | 400 | 1 | 85 |
| `battle.core_lost` | `core_destroyed`, `side` 0 | no | 3 | 400 | 1 | 85 |
| `battle.overload_started` | `overload_started` | no | 3 | 2000 | 1 | 75 |
| `battle.overload_level` | `overload_level`, `level` 2 or more (level 1 comes with `overload_started`) | no | 2 | 1000 | 1 | 65 |
| `battle.overload_pulse` | `overload_core_damage` (a Core decays) | no | 2 | 1500 | 1 | 50 |
| `battle.poi_capture_start` | `point_capture_started` | no | 2 | 500 | 1 | 55 |
| `battle.poi_captured` | `point_captured` | no | 3 | 500 | 1 | 75 |
| `battle.boss_burst` | `burst_released` | no | 3 | 500 | 1 | 80 |
| `battle.boss_pylon` | `pylon_destroyed` | no | 3 | 300 | 1 | 75 |
| `battle.boss_shield_down` | `core_shield_down` | no | 3 | 500 | 1 | 80 |

The battle ending is a music cue (below), not an effect.

Events that play nothing: `produced`, `delivered`, `lost`, `stalled` (flow,
too frequent and not a battle moment), `guard_spawned` and
`unit_retargeted` (not moments the player acts on), `conduit_destroyed`
(its building's `building_destroyed` covers it), `ramp_step`,
`core_hit_blocked` (the shipped targeting never produces it) and
`battle_ended` as an effect.

**Reserved for later features.** The events above for points (#375) and
boss mechanics (#402) already exist in `schemas/sim-event.schema.json`, so
their cues are in the table now and are not reserved. A later feature that
adds a battle event adds a cue and a `battleMap` row the same way (AU-41)
and a sound; it does not change the engine. The only reserved cue is
`event.caravan_turn`.

### Music (`music`)

| ID | Plays | P | gap | max | vol |
| --- | --- | --- | --- | --- | --- |
| `music.build` | The calm loop: main menu, specialist pick, Core placement, shop and build, events, summary, run over | 1 | 0 | 1 | 100 |
| `music.battle` | The livelier loop: from `zone_revealed` until `battle_ended` | 1 | 0 | 1 | 100 |
| `music.win` | A stinger (about 4 s), at `battle_ended` with `winner` 0 | 3 | 0 | 1 | 100 |
| `music.loss` | A stinger (about 5 s), at `battle_ended` with `winner` 1 | 3 | 0 | 1 | 100 |

The `vol` of music is relative to the `music` group, which defaults to 50
(AU-21), so loops sit under the effects.

## Battle playback rules

- **AU-33 [PROPOSED]** The battle audio is driven by **playback**, in the
  order of the event log. The web playback hands the audio module, on each
  frame, the events of the ticks it just passed, with a `mode`: `play`
  (a normal step) or `seek` (a jump of more than 8 ticks, skip, or a scrub).
  Audio keeps no event log of its own, and works the same for a live battle,
  a replay and a ghost's battle.
- **AU-34 [PROPOSED]** **Thinning.** Thinned cues belong to one of three
  classes: `attack` (the cues marked attack), `spawn` and `death`. Each
  class has a **window** in wall-clock milliseconds: after one of its cues
  plays, no other cue of the class plays until the window has passed. The
  windows at speed 1× are 250 ms for `attack` (at most 4 attack sounds per
  second, whatever happens on screen), 333 ms for `spawn` and 333 ms for
  `death` (about 3 per second). When several cues of a class arrive in the
  same frame, only the best is considered: the highest priority, then the
  largest `damage` (zero for classes without it), then the lowest unit ID.
  So a Core hit (`battle.core_hit_low` over `battle.core_hit` over
  `battle.foe_core_hit`) beats the other attacks of its frame and waits at
  most one window.
- **AU-35 [PROPOSED]** **Ducking.** The music gain is multiplied by a duck
  factor that moves toward a target: it falls to `duck.gain` in 40 ms when
  a cue with a `duck` plays and returns to 1 over 400 ms after `holdMs`. The
  deepest active duck wins (they do not multiply). Ducks:
  `music.win` and `music.loss` fade the loop out instead (AU-39);
  `run.new_best` 0.3 for 2500 ms; `run.over` 0.5 for 1500 ms;
  `battle.core_hit_low` 0.6 for 300 ms; `battle.core_hit` 0.8 for 200 ms;
  `battle.core_lost` and `battle.core_destroyed` 0.4 for 1000 ms;
  `battle.overload_started` 0.6 for 1200 ms;
  `battle.boss_burst` 0.6 for 600 ms.
- **AU-36 [PROPOSED]** **Core health.** `battle.core_hit_low` plays when the
  hit Core (or the shared pool of linked Cores) has 30% or less of its
  maximum health. The playback state knows the health; the event does not
  carry it.
- **AU-37 [PROPOSED]** **Playback speed.** The window lengths of AU-34 are
  multiplied by 1 at 1×, 1.33 at 2× and 2 at 4×, so the rate of thinned
  sounds is 1 at 1×, 0.75 at 2× and 0.5 at 4× (half the effect rate at 4×).
  Key moments are not thinned, but their `minGapMs` is multiplied the same
  way. Effect sounds are never sped up or pitched: only how many play
  changes with speed. The music tempo is also unchanged.
- **AU-38 [PROPOSED]** **Seeking and skipping.** In `seek` mode no battle
  cue plays: the backlog is thrown away, not played fast. At the end of the
  battle (`battle_ended`, also after a skip) only the stinger plays (AU-39).
  A pause plays nothing and keeps voices running out; resuming plays
  nothing from the past. A battle opened from a saved result (CP-23a) with
  playback finished plays no battle cue, only `music.build`.
- **AU-39 [PROPOSED]** **Music changes.** On `zone_revealed` the build loop
  fades out and the battle loop fades in over 1500 ms (the **crossfade**,
  equal power), starting from its beginning. At `battle_ended` the battle
  loop fades out over 400 ms and the stinger for the winner plays at once
  over silence; when the stinger ends, `music.build` fades in over 1500 ms
  for the summary. In `seek` mode the same happens without the first
  crossfade. Entering any other screen keeps the music that is playing
  unless that screen has a different track in the table. Starting a loop
  that is already playing does nothing. Only one stinger plays at a time.

## Files and formats

The web build and the Godot port share these files. The generator, the
engine and the validator are separate steps (#447 to #451); this section is
the contract between them.

### Content files

- **AU-40 [PROPOSED]** Three content files, each with a schema in
  `schemas/`, registered in `packages/tools/src/registry.ts` so
  `pnpm validate:content` checks them, and listed in `content/README.md`:

  | File | Schema | Holds |
  | --- | --- | --- |
  | `content/audio.json` | `schemas/audio.schema.json` | `version`, `groups`, `mix`, `cues`, `battleMap` |
  | `content/sounds.json` | `schemas/sounds.schema.json` | the effect sounds: synthesis parameters |
  | `content/music.json` | `schemas/music.schema.json` | the loops and stingers: tempo, scale and note patterns |

  They hold no display text and no rules. Player-facing words (the Sound
  panel) are in `content/presentation.en.json`.
- **AU-41 [PROPOSED]** `content/audio.json`:
  - `groups`: `{ "master": 80, "music": 50, "effects": 80 }`, the defaults of
    AU-21.
  - `mix`: `{ "effectVoices": 16, "duckAttackMs": 40, "duckReleaseMs": 400,
    "crossfadeMs": 1500, "stingerFadeMs": 400, "lowCorePercent": 30,
    "thinWindowMs": { "attack": 250, "spawn": 333, "death": 333 },
    "speedFactor": { "1": 1, "2": 1.33, "4": 2 }, "seekJumpTicks": 8 }`.
  - `cues`: an object from cue ID to `{ "group", "priority", "minGapMs",
    "maxVoices", "volume" }` and the optional fields of AU-25 (`sound`,
    `variants`, `duck`, `enabled`, and `thin` set to `attack`, `spawn` or
    `death`). Every ID in the tables above is a key.
  - `battleMap`: an array of rows `{ "event": <sim event type>, "when":
    { ... }, "cue": <cue ID> }`, tried in order; the first row whose `when`
    matches wins, and an event with no matching row plays nothing. `when`
    keys: `side` (0 or 1: the event's `side`; for `unit_attacked`, the `side`
    of its target when that is a building or a Core), `target`
    (`unit`, `building` or `core`), `coreLow` (true or false, AU-36) and
    `levelAtLeast` (an integer). Empty `when` matches all. An event with `side` 2 (a neutral guard) plays nothing, and the death of a unit of a side carries no `side`, so its row has an empty `when`. The rows are
    exactly the Event column of the battle table.
  - **Checks** (in the validator, #449): every key of `cues` and every
    `sound` or `variants` entry is a sound in `content/sounds.json` or, for
    `music` cues, a track in `content/music.json`; every `battleMap` row
    names an event type that exists in `schemas/sim-event.schema.json` and a
    cue that exists; every cue with a `sound` has a generated file (AU-42).
- **AU-42 [PROPOSED]** `content/sounds.json` has `version`, `sampleRate`
  (22050) and `sounds`, an object from sound ID to a recipe:

  | Field | Meaning |
  | --- | --- |
  | `wave` | `sine`, `triangle`, `square`, `saw` or `noise` |
  | `seed` | integer; the only source of noise (a fixed generator, no `Math.random`) |
  | `freq` | start frequency in Hz (40 to 4000) |
  | `slide` | pitch change in octaves per second (negative falls) |
  | `minFreq` | floor in Hz that stops a falling slide |
  | `duty` | 0 to 1, the pulse width of `square` (0.5 square, lower is thinner) |
  | `attackMs`, `holdMs`, `decayMs` | the volume envelope; the length is their sum |
  | `vibrato` | `{ "depth": semitones, "rateHz": n }` |
  | `arpeggio` | `{ "steps": [semitones...], "stepMs": n }`, the pitch jumps through the list |
  | `lowpass`, `highpass` | cut-off in Hz (a one-pole filter), optional |
  | `gain` | 0 to 1, peak level before the cue volume |

  Rules: the sum of the three envelope times is at most 1200 ms; `freq`
  and every filter are below 6 kHz in practice (AU-12); the generator
  fails on anything outside these limits.

### Generated files

- **AU-43 [PROPOSED]** `pnpm audio:build` (a script of `packages/audio`, like
  `pnpm art:build`) writes, from `content/sounds.json`:
  - `assets/audio/sfx/<soundId>.wav`: one file per sound, **mono, 22,050 Hz,
    16-bit PCM, plain RIFF/WAVE with a 44-byte header and no other chunks.**
    WAV needs no encoder, so the bytes are the same on every run, and
    Godot imports it as is. A recorded replacement may be OGG Vorbis
    with the same sound ID.
  - `assets/audio/manifest.json`: `{ "version": 1, "sampleRate": 22050,
    "files": [ { "id", "file", "bytes", "durationMs", "sha256" } ] }`, sorted
    by `id`, two-space JSON with a final newline.

  Generation is a pure function: samples are computed in double precision,
  rounded to integers, written little-endian. There is no `Date`,
  `Math.random` or other clock; noise comes from the recipe's `seed`. The
  generated files are committed. A test in `packages/audio` regenerates all
  in memory and fails if a committed file or the manifest differs (as
  `packages/art` does for the sprite atlas), and another checks the size
  limits of AU-44. The sound IDs are exactly the effect cues of the cue list
  (every `ui`, `build`, `shop`, `run` and `battle` row; not `music.*` and not
  the reserved `event.caravan_turn`); a test reads the cue tables of this file
  and fails when the sets differ. In the manifest, `file` is relative to
  `assets/audio` (`sfx/<id>.wav`), and `durationMs` is rounded. The recipes
  are also validated by `pnpm validate:content` (`packages/audio` exports the
  loader). The copy into `dist` is done by the web build (#448).
- **AU-44 [PROPOSED]** **Size budget.** All audio, counted as bytes
  downloaded without compression, is at most **2 MB** (AU-6). Planned split:
  - effects (`assets/audio/sfx`): at most 1.0 MB in total, and at most
    56 KB per file (1.2 s at the format above). About 55 sounds of 0.1 to
    0.5 s come to roughly 0.6 MB;
  - music and stingers: **0 bytes of audio**, they are synthesised in the
    browser from `content/music.json` (AU-45); the data is at most 30 KB;
  - manifest, `audio.json`, `sounds.json`, `music.json`: at most 60 KB in
    all.

  That leaves about 0.9 MB of room. If the effects pass the limit, first
  shorten the longest sounds, then lower the sample rate to 16,000 Hz. The
  limit is tested (AU-43) and the sizes are recorded in
  `docs/performance-budget.md` ("Audio budget").
- **AU-45 [PROPOSED]** `content/music.json` has `version` and `tracks`, an
  object from track ID (`music_build`, `music_battle`, `music_win`,
  `music_loss`) to:
  - `bpm` (integer), `beatsPerBar` (4), `bars`, `loop` (true for the two
    loops, false for stingers);
  - `root` (a MIDI note number) and `scale` (semitone offsets, for example
    `[0, 2, 4, 7, 9]`, a major pentatonic, so any note fits any other);
  - `voices`: a list of `{ "instrument", "gain", "pattern" }`, where
    `instrument` is `pluck`, `pad`, `bell` or `bass` (a recipe by name,
    defined once in the same file: `wave`, envelope times, `lowpass`), and
    `pattern` is an array of `bars` strings of 16 steps, each step a scale
    degree (`0` to `9`, `a` to `f` for the upper octave) or `.` for a rest.

  Proposed starting points: `music_build` at 84 bpm, 16 bars, root C3, pad
  and soft pluck, about 46 s; `music_battle` at 112 bpm, 16 bars, the same
  scale a step livelier, with a bass line and ticking bells, about 34 s;
  `music_win` 2 bars at 120 bpm, rising, about 4 s; `music_loss` 2 bars at
  90 bpm, falling and soft, about 5 s. All voices are built from
  the same recipes as the effects, scheduled on the audio clock in loop
  lengths, so a loop repeats with no gap. The track's scheduling is data
  driven, so Godot can play it the same way (or render each to a file, with
  the same IDs, for AudioStreamPlayer).
- **AU-46 [PROPOSED]** Sound IDs, cue IDs and track IDs are never renamed
  or reused (as AU-24). A replaced sound keeps its ID.

## Where each part is built

| Issue | Builds |
| --- | --- |
| #447 | `packages/audio`: `content/sounds.json`, its schema, the synthesiser, `pnpm audio:build`, the committed files, the stale and size tests |
| #448 | `packages/web/src/audio/`: the engine (context and unlock, groups, voices, gaps, `maxVoices`, ducking, visibility), the settings and their storage, the Sound panel, `content/audio.json` and its schema; tests against a fake `AudioContext` |
| #449 | The cue calls from the build, shop, event and run screens (every `ui`, `build`, `shop`, `run`, `event` row) |
| #450 | The `battleMap` reader, the thinning windows, speed, seek and ducking from the arena event log (every `battle` row) |
| #451 | The music synth from `content/music.json`, the crossfade and stingers |
| #452 | The mix pass (every [PROPOSED] number), a playtest, the Godot note |

The engine is pure logic behind an injected port (a small interface for
"start sound", "stop", "set gain" and "now"), so tests run with a fake
context and never listen. Smoke checks may assert state, such as that the
settings persist, never sound.

## For the Godot port

- Reuse as they are: `content/audio.json`, `content/sounds.json`,
  `content/music.json`, `assets/audio/sfx/*.wav` and the manifest, the cue
  and sound IDs, and the rules AU-20 to AU-39.
- Cues are the hook: the port implements the engine (an `AudioStreamPlayer`
  pool of 16, the buses `Master`, `Music` and `Effects`, thinning and
  ducking as above) and reads `battleMap` to map arena events. Godot's
  buses replace the gain formula only where the result is the same
  (AU-21).
- A sound can be replaced by a recorded file with the same ID. Nothing else
  changes.
