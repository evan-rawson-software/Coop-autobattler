# UX playtest notes — 2026-11-14

Scope: confusing text and UI for human players (not balance, not art).
Setup: the GitHub Pages URL was unreachable from the test environment's network, so the
game was built from this branch (`pnpm build`, build 9bfcb01) and played via `vite preview`
in headless Chromium at 1280×800.

## Findings

### Main menu
1. **No player-count choice before a run.** The menu advertises "1–4 players" and keeps
   records per player count, but "New run" goes straight into Core placement with no prompt
   for how many players or how others join. Players won't know how to start a co-op game.
2. **"Developer" section is visible to players.** Links like "Debug board", "Sample shop" and
   "Clear ghost pool" sit on the main menu. "Clear ghost pool" in particular is jargon and
   sounds destructive with no explanation/confirmation context.

### Core placement (first screen of a run)
3. **No instruction on how to place the Core.** The side panel only says "It can't be moved
   once you are Ready." It never says *what to do* (e.g. "Click a green tile to place your
   Core"). The legend explains colours but not the action.
4. **"Ready" is disabled with no reason given.** A greyed button with no tooltip/hint.
5. **Empty white box under the board.** A blank input-looking rectangle sits below the map
   with no label or content; looks like a broken text field.
6. **Map icons have no legend.** Lightning bolts, brown rocks and the purple crystal are not
   explained (resource nodes?), and "FRONT EDGE" is shown without saying what it means
   (where enemies come from?).
7. **"Starting kit" items look like buttons.** "Extractor × 2", "10 gold" etc. are styled as
   bordered buttons but are (at this stage) just information; unclear whether to click them.
8. **"24 enemy routes" appears with no meaning.** After choosing a spot, a count appears but
   doesn't say whether 24 is good or bad, or what the player should do about it.
9. **Coordinate formats are inconsistent.** Core placement says "column 8, row 3"; the build
   phase says "At (10, 9)". Players can't see grid numbers on the board, so neither helps much.
10. **Wrong-target click on "Ready" text.** "It can't be moved once you are Ready." uses the
    button's label as prose right next to the button — minor, but "after you press Ready"
    is clearer.

### Build phase
11. **Stash and Overlays panels are clipped at 1280×800.** Only Extractor and Barracks are
    visible in the Stash; Wall and Turret are hidden below the fold of a small scrolling box
    with no scroll cue. The "Dry run ticks" input is cut off at the bottom of Overlays.
12. **Developer jargon in the main UI.** "Dry run ticks 600 / 10 ticks = 1 s", "Dry run 60s",
    "Next: PvE · 0 of 1 ready", "T1" badges, "Conduit · free". New players won't know what a
    dry run, tick, PvE, T1 or conduit is.
13. **Phase shown twice and looks like a button.** An orange "Build" pill in the header centre
    plus plain "Build" text on the right. The pill looks clickable.
14. **Problems text is hard to parse.** "Extractor in stash: 7 free nodes (Power, Flux, Ore)."
    Better: "You have 2 Extractors unplaced — place them on a resource node (7 available)."
15. **Ready lets you skip building with no warning.** With all 7 buildings still in the stash,
    pressing Ready immediately advances. A confirm ("You have 7 unplaced buildings — ready
    anyway?") would prevent accidental skips.
16. **Placement hint is in a status bar far from the cursor.** After picking Extractor the only
    guidance is "R rotates · Esc cancels." at the bottom of the board; it doesn't say
    "Click a resource node". The error "Extractors only go on a resource node" only appears
    after a failed click.
17. **Selecting a stash item doesn't update the "Selected" panel.** It still says "Nothing
    selected." while an Extractor is in hand, so the large panel offers no info about it.

### PvE battle choice
18. **Cards don't look clickable / no "Choose" button.** The three difficulty cards have no
    call-to-action; it isn't obvious you click the card to start.
19. **"Overload at 3:00: their Core falls first (3:30)." is cryptic.** Highlighted in orange
    like a warning but doesn't explain what Overload is or what "falls first" means for me.
20. **"Losing costs no life."** is the only banner text; good info, but there's no heading
    telling the player what this screen is for ("Pick an opponent for this round").

### Battle screen
21. **Duplicate camera controls.** "Center / My base / Fit / + / −" floats over the board while a
    separate "Camera" panel offers "Center / My base / Their base / Fit battle". Two sets with
    slightly different names ("Fit" vs "Fit battle") for the same job.
22. **Header layout shifts between phases.** In build the header is one row; in battle/summary
    the round/lives/gold wrap onto a second row with the phase text, so the stats jump around.
23. **Opponent name repeated three times.** Stronghold panel shows "Escalator (Medium)", then an
    "Escalator" tag, plus the header "vs. Escalator (Medium)".
24. **Army Strength chart has no units/axis label.** It's unclear what "strength" measures, and
    the "(solid)/(dashed)" legend notes are redundant with the line samples.
25. **First battle-log line is jargon.** "0:00 Neutral zone revealed" — the player hasn't been
    told what the neutral zone is. Board also labels "Front edge" twice around it.

### Battle summary
26. **"Ready" is an ambiguous label for continuing.** On the summary, "Ready" next to "Watch again"
    would be clearer as "Continue to round 2" / "Back to building".
27. **No guidance after a defeat.** A loss with "Building damage 0 vs 500 · Kills 0 vs 0" (because
    nothing was built) gives no hint like "You didn't place any buildings". "Building damage
    0 vs 500" doesn't say which side is which.
28. **"Your buildings" table is empty with only headers** instead of an empty-state message.
29. **"Last Core destroyed."** — "Last" is confusing in a solo game with a single Core.

## Not covered (time limit)
Multiplayer joining, shop, later rounds, saved-run resume, and mobile layout were not tested.
