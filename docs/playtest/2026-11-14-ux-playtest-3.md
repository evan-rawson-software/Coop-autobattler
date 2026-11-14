# UX playtest #3 — 2026-11-14

Scope: confusing text and UI for human players (not balance, not art). This pass skipped
multiplayer, phone-sized screens, unexplained state changes, and anything already filed or
marked "ignore". The focus was the shop, rival-party battles and later rounds.
Setup: GitHub Pages is still unreachable from the test environment, so `main` @ eecffe3 was
built locally and played via `vite preview` in headless Chromium at 1280×800. A solo run was
played to the end of the run at round 7 (stronghold battle → event → shop → rival battle → event → shop, per round).

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

### Run over screen (reached round 7, out of lives)
10. **Round-by-round table breaks words mid-word.** The columns are so narrow that "lost" wraps
    as "lo / st", "won" as "wo / n", and the header "Stronghold" as "Strong / hold".
11. **Internal names fill the round-by-round table.** Rows read "Ghost · Bundled weak bot
    (bundled)", with "bundled" twice. The This run panel adds "vs. ghosts" and "vs. bosses";
    neither term is used anywhere else in the game.
12. **The boss appears without warning.** Round 7's rival battle is just "vs. the boss". Nothing
    earlier told the player a boss round was coming, or that it is different.
13. **"Version 1.0" is listed among the run stats.** It's build info, not a player stat.
14. **The Final factory caption is cut off.** "0 buildings placed · 0 at tier 3 · 7 in stash" is
    clipped at the bottom of its panel, while the board image above it has large empty margins.
    "0 at tier 3" also doesn't say why tier 3 matters.
15. **Odd header and duplicate exit buttons.** The header shows a lone "You" before Lives/Gold.
    "Menu" in the header and "Main menu" at the bottom go to the same place.

## Not covered (time limit)
Buying and placing purchased items. Offers are random each run, so purchases were tried only in part.
