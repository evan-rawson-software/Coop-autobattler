# UX playtest #2 — 2026-11-14

Scope: confusing text and UI for human players (not balance, not art). Only new issues are
listed — items from playtest #1 that were fixed (#256, #257, #258) or marked "ignore" are left out.
Setup: GitHub Pages is still unreachable from the test environment, so `main` @ d8153f8 was
built locally (`pnpm build`, shown as build e594d6b) and played via `vite preview` in headless
Chromium at 1280×800.

## Findings

### Header
1. **"Round 1" shown twice.** The page title on the left reads "Round 1" and the stats on the
   right start with "Round 1" again.

### Build phase — Selected panel
2. **"bought by You" on starting-kit buildings.** The Extractor/Barracks/Turret from the starting
   kit say "tier 1 · bought by You", though the player never bought them. "You" is also
   capitalised mid-sentence.
3. **Inconsistent rate units.** The same panel mixes "0.50 / s" and "0.5 / sec"
   (Extractor: "Collects 0.50 / s", "Mines Power 0.5 / sec, 0.5 / sec lost"). The Problems panel
   uses a third style, "0.00/s".
4. **Unnamed quantities in output lines.** Barracks: "~0 units / min (5 per unit)" and Turret:
   "~0 shots / min (1 per shot, at most 60)". "5 per unit" / "1 per shot" don't say of what
   (Ore? Power?), and "at most 60" doesn't say 60 what.
5. **ALL-CAPS "UNDER-SUPPLIED" mid-sentence.** "1.00 / s at top speed · UNDER-SUPPLIED: gets 0.00 / s"
   — it reads as shouting and wraps awkwardly in the narrow panel.
6. **Duplicate actions with different names.** Tools has "Rotate (R)" and "To stash"; the Selected
   panel has "Rotate" and "Return to stash" for the same actions.
7. **Stale tool highlight.** While an Extractor from the stash is "in hand", the Tools panel still
   highlights "Select / move" as the active tool.

### Build phase — Problems panel
8. **Problems list overflows and gets cut off.** After placing three buildings, the list has
   seven entries and the last ("4 buildings in the stash") is clipped behind a fade at the
   bottom of the panel, with no visible scroll cue.
9. **Duplicate warnings for one cause.** An unconnected Barracks produces both "Barracks has no
   conduit into its Ore input." and "Barracks gets 0.00/s of the 0.50/s it needs." (same for
   Turret), doubling the list length.
10. **Two warning icons without explanation.** Filled ⚠ and outlined △ are mixed; the
    difference in severity isn't explained.

### Build phase — Test run
11. **Test-run results still titled "Dry run".** The button now says "Test run 60 s", but the
    results popup header is "Dry run · 600 ticks (60 s)".
12. **"Test run 60 s" label ignores the Advanced setting.** After changing "Test run length
    (ticks)" to 300, the button still says "60 s".
13. **Results popup covers the board.** It opens over the top-right of the map, hiding part of
    the player's base. Column headers "Need / s (all inputs)" and "Supply (all inputs)" are dense.

### Battle summary
14. **"Building damage: You 0, Them 500" is still ambiguous** — it doesn't say whether this is
    damage dealt or damage taken. "Damage dealt to buildings" would remove the doubt.
15. **"Continue to the event"** refers to "the event" before the player has seen what an event is.

### Event screen
16. **Event cards have no call-to-action and no heading.** Unlike the battle cards (which now have
    a FIGHT button and a heading), Shrine / Workshop / Windfall have neither "Choose one" nor a button.
17. **Card descriptions hide important details.** "Shrine: Gain a bonus for the rest of the run"
    doesn't hint at the options; "Workshop: Upgrade a building" doesn't mention it costs gold —
    with 10 gold most upgrades turn out to be "Not enough gold".
18. **Workshop: identical rows, unexplained upgrade, duplicate heading.** Three identical
    "Wall · Stash · Tier 1 → 2 · 7 gold" rows (and two Extractor rows) with no way to tell them
    apart; "Tier 1 → 2" doesn't say what improves; "Upgrade a building" appears twice; "Skip"
    doesn't say whether the event is lost.
19. **Shrine: "Stacks" tag unexplained** on "Drilled troops".

### Shop + Build
20. **Round counter doesn't advance.** After the round-1 battle and event, the header still says
    "Round 1" and Next battle says "Rival party · round 1" — it's unclear what a "round" is.
21. **Gold changes with no explanation.** Gold went from 10 to 15 after a lost battle ("No reward")
    and choosing the Shrine; nothing tells the player where the 5 gold came from.
22. **Internal jargon in Next battle.** "Opponent: ghost of Bundled weak bot". "Ghost" and
    "Bundled weak bot" are internal names. The Overclocker card also says "(0.25 steps / s)".
23. **Identical offer cards and an unexplained lock icon.** Three identical Barracks cards and two
    Overclockers side by side; each card has a padlock icon with no tooltip (lock offer for
    the next re-roll?).
24. **Redundant navigation.** "Shop / Build" tabs in the header and an "Open Build" button under
    Your factory do the same thing. Gold is shown in the header and again in a large Gold panel
    ("15 gold" with the word "gold" twice).
25. **"Drop here to sell" implies drag-and-drop**, but every stash row also has a Sell button; it's
    unclear whether dragging works or which to use.
26. **Empty strip at the bottom of the Shop screen** — a blank bordered bar sits below the panels.

## Not covered (time limit)
Multiplayer joining, a PvP ("Rival party") battle, buying items, later rounds, run end, mobile layout.
