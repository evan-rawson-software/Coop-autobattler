# Playtest guide

## Open the latest build

Open <https://evan-rawson-software.github.io/Coop-autobattler/> in a current desktop browser. It is rebuilt from `main`. Your runs are saved in your browser, so use the same browser and profile to continue them. A private window forgets everything when you close it.

## What a run looks like

Place your Core, then repeat each round: build, pick a PvE battle, watch it, pick an event, shop and build again, then fight a PvP battle. Losing a PvP battle costs one life. You start with 5 lives, and the run ends at zero.

The shop tells you who the PvP opponent is before you ready up. It is either a ghost (a snapshot of another factory, with its owner label) or the boss. Ghosts labelled "Bundled" come with the game; the others are snapshots your own earlier runs left in this browser. Rounds 1 to 6 have bundled ghosts, later rounds meet the boss. The Run over screen lists every opponent and result.

## What the numbers are meant to do

The shop also offers the Range (trains archers, which shoot from three cells away and can hit flyers) and the Hangar (builds drones, which fly over walls and lakes); their numbers are placeholders, and the bots use them too. From round 4 on, PvE waves also contain archers (about a quarter of a wave's strength) and drones (about a seventh), so build turrets or Ranges: melee units cannot hit drones. A Hangar can be walled in completely: its drones appear next to it and fly out over the walls, so it never blocks Ready (a walled-in Barracks or Range still does). Supply is scarce: one collector fully feeds one building of the same tier (a tier 1 collector gives 0.50 items per second, and a tier 1 Barracks, Overclocker or Armory takes at most that much). Your area has three Ore, three Power and one Flux node, so it can run three Barracks at full speed and no more; to grow after that, raise tiers, use the Overclocker (at most +25% collector speed) or the Armory (+25% to +50% unit health and damage, at most +100% per player), or share through a border link. You earn 9 to 26 gold per round. Threats grow 25% per round, and strongholds have at most 6 turrets per area. A competent build should beat hard PvE through about round 5, find it a gamble in rounds 6 to 8, and meet the round-5 boss at every party size with a fair chance.

## What to try

- Play at least two runs back to back, and look for your first run's factory in the second.
- Try each of the three strategies on different runs, and note how they differ.
- Route resources with long and short conduits, and see what changes.
- Look at the opponent's factory during a PvP battle and see why it won or lost.
- Reload the page in the middle of a step to check your run comes back.

## Choosing the opponent (for testing)

Open the `#debug` page (add `#debug` to the address) and use "Next PvP opponent" to force the boss. It applies the next time a shop fixes an opponent, and stays set in your browser until you switch it back to Automatic. Normal play never needs it.

## Feedback that helps most

- Is routing fun, or a chore? When did it feel good or tedious?
- Did the three strategies feel different, and did one dominate?
- How long did building take per round, and was that too long or too short?
- Where did your runs end (round and cause), and did it feel fair?
- Anything that confused you, broke, or looked wrong, with what you were doing at the time.

Send it as a note on the issue tracker or in your own words.
