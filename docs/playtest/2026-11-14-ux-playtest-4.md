# UX playtest #4 — 2026-11-14

Scope: confusing text and UI for human players (not balance, not art). This pass looked for
new issues only. It left out multiplayer, phone-sized screens, unexplained state changes,
everything in issues #256–#273, and items marked "ignore".
Setup: GitHub Pages is still unreachable from the test environment, so `main` @ eecffe3 was
built locally and played via `vite preview` in headless Chromium at 1280×800. This was a longer
session, focused on build-phase interactions (conduits, moving, overlays, undo), the shop
(buying and placing), Workshop/Shrine, save/resume and keyboard use.

## Findings

### Conduits
1. **Placing a building with its output facing the board edge isn't flagged.** An Extractor
   placed on a node in the top row keeps its default north-facing output, which points off the
   board. No warning appears at placement or in Problems; the problem only shows later, when
   conduits fail.
2. **"No route to that cell." / "No route to that side." doesn't say why.** In the case above,
   every conduit attempt failed with these messages. Nothing says the output faces the edge or
   suggests rotating the building.
3. **Input/output sides are hard to see.** The conduit hint says "Click a building's output side,
   then an input side.", but the side markers are tiny circles (about 8px at default zoom). On a
   1×1 Extractor the output marker overlaps the sprite.
4. **Conduit shown as "#4" in the Selected panel.** The Barracks lists "Conduits: #4" as a link.
   Conduit numbers aren't shown anywhere on the board, so "#4" means nothing to the player.
   The Test run results table does the same with buildings ("Extractor #1", "Barracks #3").
5. **No route preview before committing.** A conduit to a Barracks 4 tiles away was laid as a
   20-cell detour ("Conduit added (20 cells).") with no preview of the path before the click.
6. **The Selected panel stays on "Nothing selected." in conduit mode** even after a source
   building is picked (it is highlighted on the board), so the panel can't show what's being
   connected.

### Overlays
7. **"Resource flow" has no visible effect or legend.** Turning it on with a working
   Extractor → Barracks conduit made no noticeable change to the board, and there's no legend
   explaining what it should show.
8. **Enemy paths overlay has no legend.** It draws solid and dashed red lines plus red triangles
   along the front edge. Nothing in the build phase explains solid vs dashed, or what the
   triangles mean. The Core-placement legend only says "Enemy routes".

9. **Test run accepts a length of 0 or less.** Setting "Test run length (ticks)" to 0 or −5
   relabels the button "Test run 0 s", and running it shows an empty results table with no
   message. The field should clamp the value or show an error.
10. **Problems entries look like buttons but do nothing visible.** Clicking "You have 2 Extractors
   to place…" doesn't select an Extractor, highlight a free node or change the status bar.

### Keyboard
11. **Delete / Backspace do nothing on a selected building.** "Return to stash" has no keyboard
   shortcut, though Rotate (R), tools (V/C/E) and Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) do.
   Ctrl+Y (the common Windows redo) says "Nothing to redo." even when Ctrl+Shift+Z would redo.

### Shop + Build
12. **Internal state name in the Build tab's status bar.** After buying in the Shop and switching
    to the Build tab, the status bar reads "Everyone is ready: the run moves from build to
    pve_choice." "pve_choice" is an internal identifier. The message is also stale: it describes
    the round-1 Ready press, not the current state, where nobody is ready yet.
13. **Purchases go to the stash with no visual cue.** "Bought Turret." appears only in the status
    bar at the bottom of the screen. The stash row just changes "× 1" to "× 2", with no highlight,
    so it's easy to miss where the purchase went.

### Battle replay
14. **"Watch again" looks exactly like a live battle.** The replay has the same header, the
    "Battle time" clock, the speed controls and Skip. Nothing says it's a replay, and there's no
    "Back to results" button. Skip is the only (unlabelled) way back.

### Workshop
15. **Upgrades are spent instantly, but selling asks for confirmation.** Clicking a Workshop row
    immediately spends the gold and leaves the screen ("Upgraded Wall to tier 2 (−7 gold)."),
    while selling a 2-gold Wall in the shop asks "Sell Wall (tier 1) for 2 gold?". The more
    costly action has no confirmation or undo.
16. **Status messages are dismissed in different ways.** The Workshop result has a "Dismiss"
    button. Other status messages ("Re-rolled.", "Bought Turret.") have none and linger.
17. **No way back from Workshop or Shrine to the event choice.** Clicking Workshop or Shrine by
    mistake commits you. Workshop offers only "Skip (no upgrade)", and Shrine has no back or skip
    at all.

### Shrine
18. **Shrine cards don't match the event cards.** The event screen now has a "Choose one" heading,
    icons and CHOOSE buttons. The Shrine's bonus cards have no button and no icons, under a plain
    "Choose a bonus" banner.
19. **Chosen bonuses aren't shown anywhere afterwards.** After picking "Sharp turrets", the name
    or effect doesn't appear on the Shop, Build or Battle screens. Players can't review which
    bonuses they've taken, and "Stacks (can be taken again)" is hard to use without seeing the
    current stack count.

### Saved runs
20. **Abandon confirmation doesn't say what's lost.** "Abandon this run? Abandon it / Cancel"
    doesn't say whether the run is deleted for good or whether its progress still counts toward
    Records.

### Battle and results
21. **"The battle is about to begin…" toast covers the camera controls.** At 1024×768 it sits on
    top of the Fit / + / − buttons at the start of every battle.
22. **"Continue (choose a reward)" right after "No reward".** On a lost stronghold battle the
    results banner says "No reward", and the button below says "Continue (choose a reward)".
    The event pick is a separate thing, but the wording contradicts the banner.
23. **Battle-log entries are rendered as disabled buttons.** "0:00 Battle starts" is a `<button
    disabled>`, which suggests it's clickable (jump to time?) but does nothing.

24. **The live Army Strength chart's "now" marker looks like a data spike.** During a battle a
    tall solid black vertical line is drawn at the current time on the small chart (axis
    0:00–1:00). It reads as a sudden jump in strength, not a time cursor.
25. **The default battle camera cuts off the bottom of the player's own board.** At 1280×800 the
    initial view shows the stronghold in full, but the bottom rows of "Your board" are cut off.
    The player has to press Fit to see their own base.

### Smaller desktop window (1024×768)
26. **The Stash is clipped again at 1024 wide.** It switches to one column and shows only
    Extractor, Barracks and Wall. Turret is hidden below the fold, with no scroll cue (#257 fixed
    this at 1280×800 only).
27. **Shop stash rows wrap badly at 1024 wide.** "Extractor T1" and "× 2" end up on separate
    lines, and the Sell buttons wrap to "Sell · / 5" and "Sell · / 10".

### Main menu after a finished run
28. **The run summary can't be revisited.** Once you leave the Run over screen, the only trace of
    the run is "1 player · round 6" under Records. There's no link back to that run's
    round-by-round summary, and no history of earlier runs.

## Additional requested changes (from the project owner)

### Build screen
29. **Hide the ready status in solo games.** The Party panel shows "ready: no" and
    "Next: Stronghold · 0 of 1 ready" even when playing alone. Only show the ready state and the
    "N of M ready" count when the party has more than one player.

### Shop screen
30. **Hide "Needs: nothing".** When a building consumes nothing (Wall, Gate, Extractor…), leave
    out the "Needs:" line entirely.
31. **Say "Uses", not "Needs".** Replace "Needs: Ore" / "Needs: Flux" etc. with "Uses: Ore" /
    "Uses: Flux".
32. **Put building health on its own line.** Health is currently tacked onto the end of the effect
    line ("… · 60 health"). Show it as a separate line.
33. **Remove the duplicate rate descriptions, for every building.** The Extractor shows its output
    twice: "Collects 0.50/s" and "Mines its node: 1 every 2 s". Remove the "Mines its node…" part,
    and apply the same rule to every building: show each rate once. For a building that
    consumes a resource, just say "Uses <resource> <rate>" (e.g. "Uses Ore 0.50/s"). Drop
    "at top speed"; it's implied.
34. **Remove the red "Need N more gold." text.** A disabled "Buy · 20 gold" button next to the
    gold total is enough for the player to work it out.
35. **Remove "Opponent: a recorded rival party" from Next battle.** The panel heading already
    says "Rival party · round N", so the line repeats it.
36. **Remove drag-to-sell.** Selling has two ways: the Sell button on each stash row and the
    "Drag a building here from the stash to sell" drop zone. Keep the Sell button and remove the
    drop zone.

### Battle screen
37. **Remove the walls text under the Core health.** Drop the "No walls" message and the
    "Walls: N / N standing" count, on both the player's side and the opponent's (Stronghold /
    Enemy) panel. The player can see walls on the board.

## Not covered
Multiplayer and phone-sized screens (out of scope by request). Placing purchased route buildings
(Splitter/Merger) and multi-conduit networks were only partly tried.
