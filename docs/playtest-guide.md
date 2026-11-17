# Playtest guide

## Open the latest build

Open <https://evan-rawson-software.github.io/Coop-autobattler/> in a current desktop browser. It is rebuilt from `main`. Your runs are saved in your browser, so use the same browser and profile to continue them. A private window forgets everything when you close it.

## What a run looks like

For your first run, choose "Play the tutorial" in the main menu: it is a real run with tips. Place your Core and build, then repeat each round: pick a PvE battle (the game calls it a Stronghold), watch it, pick an event, shop and build, fight a PvP battle (against a Rival party), pick an event, and shop and build again. Losing a PvP battle costs one life; losing a PvE battle costs only the reward. You start with 5 lives, and the run ends at zero.

Each player has their own plot and Core on one battlefield. To try a party of 2 to 4 on one device, open the main menu with `#/?players=2` (or 3, 4) at the end of the address; the run bar then lets you switch which player you act as.

The shop tells you who the PvP opponent is before you ready up. It is either a ghost (a snapshot of another factory, with its owner label) or the boss. Ghosts labelled "Bundled" come with the game; the others are snapshots your own earlier runs left in this browser. Rounds 1 to 6 have bundled ghosts, later rounds meet the boss. The Run over screen lists every opponent and result.

## What the numbers are meant to do

The shop also offers the Range (trains archers, which shoot from three cells away and can hit flyers) and the Hangar (builds drones, which fly over walls and lakes); their numbers are placeholders, and the bots use them too. From round 4 on, PvE waves also contain archers (about a quarter of a wave's strength) and drones (about a seventh), so build turrets or Ranges: melee units cannot hit drones. A Hangar can be walled in completely: its drones appear next to it and fly out over the walls, so it never blocks Ready (a walled-in Barracks or Range still does). Supply is scarce: one collector fully feeds one building of the same tier (a tier 1 collector gives 0.50 items per second, and a tier 1 Barracks, Overclocker or Armory takes at most that much). Your area has three Ore, three Power and one Flux node, so it can run three Barracks at full speed and no more; to grow after that, raise tiers, use the Overclocker (at most +25% collector speed) or the Armory (+25% to +50% unit health and damage, at most +100% per player), or share through a border link. You earn 14 to 31 gold per round (5 at each of the two shops, plus the battle rewards). Threats grow 25% per round, and strongholds have at most 6 turrets per area. A competent build should beat hard PvE through about round 5, find it a gamble in rounds 6 to 8, and meet the round-5 boss at every party size with a fair chance.

## Refining, the Foundry, Golems and casters (from round 3)

From round 3 the shop can offer buildings that take two resources at once. A building with two inputs needs both: each input side is marked in the colour of the resource it takes (also when you rotate it), and a conduit with the wrong resource is refused with a message that names the resource that side wants. Select the building to see how much of each resource it needs per second.

- The Foundry takes Ore and Power together and trains Heavy units, which are tougher and hit harder than soldiers.
- A refinery turns two resources into a compound at a loss: the Composite refinery combines Ore and Power, the Aether refinery combines Power and Flux. A batch uses more items than it makes. Composite is pink and Aether is teal; send the compound down the output conduit like any other resource.
- The Golem forge takes Composite and trains Golems: huge, slow units with armor, so every hit on a Golem does a fixed amount less damage (never below 1). In battle a hit that armor reduced shows a small grey shield with the damage that got through.
- The Spire takes Aether and trains casters: fragile ranged units whose hits also hurt the enemies next to the target. In battle a caster's shot flies to the target and a blast shows how far the area damage reaches.

The first time the shop offers a refinery, a one-line hint explains the chain. The flow preview lists each refining chain: what reaches the refinery, what it makes per second, and whether the Golem forge or Spire behind it is fully fed or which input is short. If a refinery is destroyed in a battle, the battle log names what it starves.

## Bosses (every PvP battle with no rival party)

When the opponent is a computer-made boss, the Next fight panel of the shop and build screens names it, says in one line what is special about it, and gives one line of counter advice. The boss is fixed before you build, so you can build against it. Later bosses join from later rounds (Brood from round 3, Bonded from 5, Pylons from 7, Warlord from 9), and Bonded needs a party of two or more.

- Boss: every third wave is a swarm of raiders. Defense against swarms.
- Brood: each of its Cores bursts out units at 75%, 50% and 25% health (ticks on the Core bar, and a line in the log). Keep defense at home.
- Bonded: its Cores share one health bar and fall together (a line joins them on the board).
- Pylons: its Cores are shielded while pylons beside them stand (blue shield and lines on the board, a count in the side panel). The shield drops when the last pylon falls.
- Warlord: each wave is led by a champion Golem, drawn larger with its own health bar.

## What to try

- Play at least two runs back to back, and look for your first run's factory in the second.
- Try each of the three strategies (rush, fortify and ramp, siege) on different runs, and note how they differ.
- Route resources with long and short conduits, and see what changes.
- Look at which boss is next, then change your factory to counter it, and see whether the battle goes differently.
- Look at the opponent's factory during a PvP battle and see why it won or lost.
- Reload the page in the middle of a step to check your run comes back.
- Build a refining chain (collectors into a refinery, then into a Golem forge or Spire) and compare it with two base buildings (Barracks) on the same collectors.
- Try the Aether chain against the Overclocker for your Flux: with one Flux node, the refinery and the Overclocker compete, and the preview shows who goes short.

## Choosing the opponent (for testing)

Open the `#debug` page (add `#debug` to the address) and use "Next PvP opponent" to force the boss. It applies the next time a shop fixes an opponent, and stays set in your browser until you switch it back to Automatic. Normal play never needs it.

## Feedback that helps most

- Is routing fun, or a chore? When did it feel good or tedious?
- Did the three strategies feel different, and did one dominate?
- In which round did you first have to leave something out, or move something, for lack of space?
- How long did building take per round, and was that too long or too short?
- Where did your runs end (round and cause), and did it feel fair?
- Is a refining chain worth the effort compared with simply building more Barracks?
- Do Golems feel tanky? Do casters feel strong against swarms?
- Is two-input routing fun, or a chore?
- Did you change what you built after seeing which boss was next?
- Anything that confused you, broke, or looked wrong, with what you were doing at the time.

Send it as a note on the issue tracker or in your own words.
