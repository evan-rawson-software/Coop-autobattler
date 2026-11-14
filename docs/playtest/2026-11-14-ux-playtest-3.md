# UX playtest #3 — 2026-11-14

Scope: confusing text and UI for human players (not balance, not art). This pass skipped
multiplayer, phone-sized screens, unexplained state changes, and anything already filed or
marked "ignore". The focus was the shop, rival-party battles and later rounds.
Setup: GitHub Pages is still unreachable from the test environment, so `main` @ eecffe3 was
built locally and played via `vite preview` in headless Chromium at 1280×800. A solo run was
played through round 5 (stronghold battle → event → shop → rival battle → event → shop, per round).

## Findings

### Rival-party battles
1. **Internal bot names still leak outside the shop.** The shop's Next battle panel now says
   "Opponent: a recorded rival party (weak)". But the battle header, Stronghold/Enemy panel,
   Army Strength legend, summary title and the following event banner all say
   "vs. Bundled weak bot", "Bundled fortify bot", "Bundled siege bot" or "Bundled rush bot".
2. **Confusing victory explanation.** Round 1 rival summary: "Victory · vs. Bundled weak bot —
   Both last Cores fell at once and every tiebreak was even: the attacker (the party) wins."
   "Last Cores", "tiebreak" and "the attacker (the party)" aren't explained, and the player
   isn't told that *they* are "the party".
3. **A Victory summary still shows defeat sections.** The same screen shows "Your Core was
   destroyed", "Core health: You 0 / 500, Them 0 / 500" and a "Where you were breached" panel
   under a "Victory" title, so the player can't tell why they won.

### Shop
4. **Shop "Next battle" text doesn't match the battle that follows.** The shop's description
   ("a recorded rival party") never matches the name shown once the battle starts, so players
   can't connect the preview to the fight.
5. **Duplicate offers still appear side by side.** E.g. round 4: Extractor, Barracks (T2),
   Extractor, Barracks (T2), Merger. The new hint "The same building can be offered more than
   once." explains it, but it doesn't say whether buying both is useful. A "×2" on one card
   would be clearer.
6. **Lock icon on offer cards is still unlabelled.** A padlock sits on the cards that cost more
   gold than the player has, with no tooltip. It reads as "locked/frozen" rather than
   "can't afford", and the red "Need N more gold." already says that.
7. **The status bar keeps old messages.** After a re-roll, "Re-rolled." stays in the bottom
   status bar after the player goes on to open the sell confirmation.

### Event banner
8. **The banner format changes with the battle type.** After a stronghold battle it reads
   "Stronghold battle lost · Easy · Fortress"; after a rival battle it reads
   "Rival party battle lost · vs. Bundled siege bot". One format would read better
   (e.g. "Lost to Fortress (Easy) · No reward").

### Battle summary
9. **Timeline labels run into their marker numbers.** The Army Strength legend renders as
   "1" + "3:00 Overload begins", which reads as "13:00 Overload begins", "25:10 Your Core
   destroyed" and so on in text and screen readers. The number badge needs separating, e.g.
   "① 3:00".

### Saved runs
10. **The saved-run entry may not update.** After a scripted run through several rounds, the
    main menu's Saved runs entry still read "Round 1 · Lives 5 / 5 · Choose a Stronghold battle
    · Last played just now". Not confirmed — this needs checking by hand.

## Not covered (time limit)
The end of a run (out of lives), and buying items. Purchases succeeded only in part, because
offers are random each run.
