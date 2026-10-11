# PokeIdle — a Pokémon idle game that plays while Claude works

PokeIdle is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview). While Claude works, your team
travels through Kanto (Generation 1, the 151 original Pokémon): it battles wild Pokémon, catches new ones,
levels up, evolves, beats trainers and gyms, and in the end challenges the Elite Four. A block under the spinner shows the battle while
Claude works, and `/pokeidle` opens a pane to manage the party, the PC, the bag, the Mart and the map.

Tested with Claude Code v2.1.292 – v2.1.296.

## Install

Load it for one session:

```bash
claude --plugin-dir ./poke-idle-cc
```

To install it for every session, add the folder that holds this one as a marketplace (it has a
`.claude-plugin/marketplace.json` named `claude-poke-idle`), then install from it:

```bash
claude plugin marketplace add /path/to/codingidlegame
claude plugin install poke-idle-cc@claude-poke-idle
```

From GitHub, in one step (the repository is private, so you need access to it):

```text
/plugin install poke-idle-cc --marketplace caiocinel/claude-poke-idle
```

Then run `/pokeidle`, enter a trainer name, and pick your starter: Bulbasaur, Charmander, Squirtle or Pikachu.

## How Claude's work drives the game

| What Claude does | What happens in the game |
| :- | :- |
| A turn is running | The team plays one battle turn every 5 s (Options → Speed: 3 s / 5 s / 8 s). A wild battle takes 10–20 s |
| A turn finishes | Task bonus: ₽(10 + 4 × tool calls) × (1 + badges), sometimes an item |
| Claude is idle | The game rests. Turn on **Idle play** to keep going slowly (one turn every 15 s), with offline progress when you come back |

The pane shows a short log of what matters: encounters, wins, catches, level-ups, evolutions and badges. The
move-by-move details are kept out of view.

A step starts a battle, plays one turn of it, or wraps it up. The team looks after itself, and each habit can be
turned off in Options:

- It heals at the Pokémon Center, drinks potions when the active Pokémon is in danger, and sends out the party member
  with the best type match against each foe.
- It throws the right ball when it wants to catch something, and buys more balls when they run out.
- Spare money (above ₽5,000) goes to the Pokédex: fishing rods, the stones or Link Cable that reach a species you
  don't have, and special Pokémon like fossils and Eevee. Mew is left for you to buy.
- The whole party learns: benched members get a third of each battle's experience (all of it with the Exp. All).
- Stronger Pokémon from the PC take the place of weak benched ones. The lead, your choice, never moves.
- Evolution stones in the bag are used on the Pokémon that can use them.
- It travels to the best zone for its level, and challenges the next gym once its three best Pokémon are ready.
  Finishing the League takes about 10–12 hours of Claude's work.
- After the League it hunts for the Pokédex: it visits the zones with the most species you haven't caught, and trains
  PC Pokémon that evolve into missing ones. About 150 of 151 after 20–30 hours.

## What's in the game

- **The 151 Gen 1 species**, with their Gen 1 types (Clefairy is Normal, Magnemite is pure Electric), base stats,
  catch rates and growth curves, and **their Red/Blue level-up learnsets**. The 165 Gen 1 moves use their original
  power, accuracy and type.
- **Gen 1 formulas**: stats from DVs, damage with STAB, the type chart, critical hits by Speed, status conditions
  (sleep, poison, burn, paralysis, freeze, confusion), stat stages, multi-hit, drain, recoil, OHKO and fixed-damage
  moves, and the catch formula.
- **25 zones** built from the **real Red/Blue encounter tables** (routes, Viridian Forest, Mt. Moon, Rock Tunnel,
  Pokémon Tower, the Safari Zone, Seafoam Islands, the Pokémon Mansion, Victory Road, Cerulean Cave…), with surfing
  and the Old, Good and Super Rod. Zones unlock with badges.
- **The legendary birds, Mewtwo and Snorlax** as rare encounters in their zones.
- **Trainer battles** every 8 wild wins, **the 8 gyms** with their leaders' Red/Blue teams, and **the Elite Four plus
  your rival**. Beating the League gives a Master Ball.
- **Evolution** by level, by stone (Fire, Water, Thunder, Leaf, Moon), and by trade (with a Link Cable), with an
  option to stop a Pokémon from evolving.
- **Shiny Pokémon** (1 in 1024), with recolored sprites.
- **Every one of the 151 species can be obtained**: in the wild, by evolution, or from the "Special Pokémon" section
  of the Mart (starters, fossils, Eevee, Lapras, Hitmonlee and Hitmonchan, Porygon, in-game trades, and Mew).
- **FireRed/LeafGreen sprites** for every species, front and back, drawn in the terminal with half-block characters.

## The interface

`/pokeidle [tab]` opens the pane. Press a number to switch tabs, or pass a tab name: `/pokeidle party`. Press Esc to
close it. The command runs even while Claude is working.

| Key | Tab | What you can do |
| :- | :- | :- |
| 1 | Battle | Watch the battle scene, HP and XP bars, and the battle log. Challenge the next gym, visit the Pokémon Center, turn idle play on or off |
| 2 | Party | See stats, DVs and moves. Choose the lead, reorder, send to the PC, release, rename, use items, stop or allow evolution |
| 3 | PC | Browse caught Pokémon sorted by recent, level, Dex number or name. Withdraw, swap with a party member, release duplicates |
| 4 | Bag | Your items. Use one on a Pokémon (potions, Revive, Full Heal, Rare Candy, evolution stones) or sell it |
| 5 | Mart | Buy balls, potions, stones, rods, Exp. All and the Amulet Coin, and the special Pokémon. Stock unlocks with badges |
| 6 | Map | Badges, the next gym, and every zone with its levels and how many of its species you've caught. Choose where the team goes; auto-travel and auto-challenge |
| 7 | Pokédex | The species you've met (`a` shows all 151): sprite, types, base stats, evolutions, and where to find each one |
| 8 | Options | Battle: what to catch, which ball, speed, potions, Pokémon Center. Team: PC swaps, stones, buying balls. Progress: auto-travel, auto gyms, idle play. Statistics and a new game |

While the pane has the keyboard, the letters shown on buttons press them: `l` makes the selected Pokémon the lead,
`d` sends it to the PC, `g` challenges the gym, and so on. Tab moves between controls and Enter presses one.

While Claude works, the game shows a small block under the spinner: your Pokémon and the foe as tiny sprites,
both HP bars, the latest event, and the party:

```text
✻ Actualizing… (17s · ↓ 80 tokens)
    ▄▄        Route 1  ₽4,746 · 1/8 badges · Dex 3/151      ▄▀▀▄
  ▄▀▀  ▄▀▀▀▀  Charmander Lv14 █████████░░░  27/37          ▀▀▀▀▀
  ▀▀▀  ▀▀▀▀▀  wild Pidgey Lv3 ████████████  15/15           ▀▀▀▀▀▀▄▀▄
   ▀  ▀▀▀▀▀▄  › A wild Pidgey Lv3 appeared!                ▀▀▀▀▀▀▀▀▀
   ▀▀▀▀▀▀▀▀▀  ● ● ●  next: Misty Lv21 · team Lv14              ▀▀▀▀▀▀
```

The last line shows the party and the next goal: the leader of the next gym and the level of your three best
Pokémon.

The block goes away with the spinner when Claude finishes. The pane only opens when you run `/pokeidle`, and closes
with Esc. `/pokeidle status` prints a text summary, and also works in `claude -p`.

## Playing online

Sign in with GitHub to sync the game between machines and battle other players:

| Command | What it does |
| :- | :- |
| `/pokeidle login` | Shows a code to enter at github.com/login/device. The session finishes the sign-in by itself once you approve. Do it once on each machine |
| `/pokeidle battle <github-user>` | Battles another player's team. Prize: ₽1,500 for a win, ₽300 otherwise |
| `/pokeidle ranking` | The top trainers by rating |
| `/pokeidle history` | Your last battles |
| `/pokeidle logout` | Unlinks this machine |

- **Sign-in** asks GitHub for no permissions: the server only learns your username, then drops GitHub's token.
- **Sync**: the save goes up once a minute while you play and at the end of each of Claude's tasks. At the start of a
  session, a newer save from another machine replaces this one.
- **Battles** run on the server with the game's own engine, from the teams the server has, so a result can't be faked
  by editing a save. Levels are capped at the weaker team's best, so a new trainer can still take on a veteran. Being
  challenged while away pays the prize the next time you start Claude Code.
- **Privacy**: the server keeps your GitHub username and id, your save and your party. Other players see your username,
  trainer name, party and record.

The server lives in `server/` of the repository and runs at `https://pokeidle.caiocinel.com`. To host it yourself,
create a GitHub OAuth App with Device Flow enabled, put its Client ID in `GITHUB_CLIENT_ID`, and run
`docker compose -p pokeidle up -d --build` in `server/`. `node server/test/flow.test.mjs` tests it against a fake GitHub.

## Saving

The game is saved in the mod's `$.store` (`~/.claude/plugins/store/`) every few seconds and at the end of each turn,
so it's the same save in every session and project. With several sessions open, the one where Claude is working plays
the game, so it never runs twice as fast; the others follow it. You can manage the team from any of them.

## Development

```text
poke-idle-cc/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json
│   ├── register.js       # hooks: session, turns, tool calls, command, pane, spinner block, saving
│   ├── ui.js             # element trees for the pane and the spinner block (pure)
│   ├── game/engine.js    # the game rules (pure, no mods API)
│   ├── game/items.js     # items, Mart, gyms, trainers
│   ├── game/sprites.js   # sprite decoding and Raster cells
│   ├── game/dex.js       # where each species is found
│   └── data/             # generated: gen1.js (PokeAPI data), sprites.js
└── tests/                # claude plugin test
```

```bash
claude plugin validate ./poke-idle-cc
cd poke-idle-cc && claude plugin test
```

`data/gen1.js` and `data/sprites.js` are generated from the [PokeAPI](https://github.com/PokeAPI/pokeapi) CSV dump
and sprites by `tools/gendata.py` and `tools/sprites.py` in the parent directory. To check balance
headless, `node tools/sim3.mjs` prints the hours of Claude work each badge takes, and
`node tools/sim2.mjs <steps>` plays one game with the default settings, and `node tools/fuzz.mjs` mixes random player
actions into thousands of steps and checks that the save stays valid.

Pokémon and Pokémon character names are trademarks of Nintendo, Game Freak and The Pokémon Company. This is a fan
project for personal use.
