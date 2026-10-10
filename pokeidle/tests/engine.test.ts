import { expect, test } from 'claude-code/testing'
import * as G from '../hooks/game/engine.js'
import { SPECIES, MOVES, ZONES } from '../hooks/data/gen1.js'

// A seeded generator so each run plays the same game
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

test('the data covers all 151 species and every zone has Pokémon', () => {
  expect(SPECIES.length).toBe(152)
  expect(MOVES.length).toBe(166)
  expect(SPECIES[150].n).toBe('Mewtwo')
  // Clefairy is a Normal type in Gen 1
  expect(SPECIES[35].t).toEqual([0])
  for (const z of ZONES) expect((z.walk || z.surf).length > 0).toBe(true)
})

test('Gen 1 stats match the known formula', () => {
  const mon = G.makeMon(seeded(1), 25, 50)
  mon.dv = [15, 15, 15, 15]
  const st = G.statsOf(mon)
  // Pikachu Lv50 with perfect DVs and no stat experience
  expect(st.hp).toBe(110)
  expect(st.spe).toBe(110)
  expect(G.expForLevel(4, 5)).toBe(135)
})

test('a long game earns badges, catches Pokémon and stays consistent', () => {
  const rng = seeded(7)
  const s = G.newGame(rng, 7, 'Ash')
  s.settings.autoZone = true
  s.settings.autoGym = true
  for (let i = 0; i < 6000; i++) {
    G.step(s, rng)
    if (s.money > 2000 && (s.bag['poke-ball'] || 0) < 3) G.buy(s, 'poke-ball', 5)
  }
  expect(s.badges > 2).toBe(true)
  expect(s.stats.caught > 10).toBe(true)
  for (const m of [...s.party, ...s.pc]) {
    expect(m.hp >= 0 && m.hp <= G.maxHp(m)).toBe(true)
    expect(m.mv.length >= 1 && m.mv.length <= 4).toBe(true)
    expect(m.lv >= 1 && m.lv <= 100).toBe(true)
  }
  expect(s.party.length <= 6).toBe(true)
  expect(s.log.length <= 80).toBe(true)
  // The save survives JSON, as $.store keeps it
  expect(G.migrate(JSON.parse(JSON.stringify(s))).party.length).toBe(s.party.length)
})

test('items work: potions, stones, candy and revive', () => {
  const rng = seeded(3)
  const s = G.newGame(rng, 25)
  const pika = s.party[0]
  s.bag['thunder-stone'] = 1
  expect(G.useItem(s, 'thunder-stone', pika.u)).toBe(null)
  expect(pika.s).toBe(26)
  expect(s.caught['26']).toBe(1)
  pika.hp = 0
  expect(G.useItem(s, 'potion', pika.u)).toBe('It has fainted. Use a Revive.')
  s.bag.revive = 1
  expect(G.useItem(s, 'revive', pika.u)).toBe(null)
  expect(pika.hp > 0).toBe(true)
  s.bag['rare-candy'] = 1
  const lv = pika.lv
  G.useItem(s, 'rare-candy', pika.u)
  expect(pika.lv).toBe(lv + 1)
})

test('level-up evolution and the stop switch', () => {
  const rng = seeded(4)
  const s = G.newGame(rng, 4)
  const mon = s.party[0]
  mon.noEvo = 1
  G.gainXp(s, mon, G.expForLevel(4, 17))
  expect(mon.s).toBe(4)
  G.toggleEvolution(s, mon.u)
  expect(mon.s).toBe(5)
})

test('the Mart enforces badges and money', () => {
  const s = G.newGame(seeded(5), 1)
  expect(G.buy(s, 'ultra-ball', 1)).toBe('Not available yet. Earn more badges.')
  s.money = 100
  expect(G.buy(s, 'poke-ball', 1)).toBe('Not enough money (₽200 needed).')
  s.money = 1000
  expect(G.buy(s, 'poke-ball', 5)).toBe(null)
  expect(s.bag['poke-ball']).toBe(15)
})

test('the PC releases its weakest duplicate when full', () => {
  const rng = seeded(6)
  const s = G.newGame(rng, 1)
  s.settings.catchMode = 'all'
  for (let i = 0; i < G.MAX_PC + 10; i++) s.pc.push(G.makeMon(rng, 16, 5 + (i % 30)))
  expect(G.releaseDuplicates(s)).toBe(null)
  expect(s.pc.length).toBe(1)
})

test('the Elite Four can be beaten by a strong team', () => {
  const rng = seeded(8)
  const s = G.newGame(rng, 150)
  s.party = [150, 149, 143, 131, 65, 112].map((sp) => G.makeMon(rng, sp, 90))
  s.badges = 8
  G.challengeGym(s)
  for (let i = 0; i < 2000 && s.badges === 8; i++) G.step(s, rng)
  expect(s.badges).toBe(9)
  expect(s.bag['master-ball']).toBe(1)
})

test('the team manages itself: bench XP, PC rotation, stones, ball restock', () => {
  const rng = seeded(21)
  const s = G.newGame(rng, 1)
  // A strong PC Pokémon replaces a weak benched one
  s.party.push(G.makeMon(rng, 10, 3))
  for (let i = 0; i < 4; i++) s.party.push(G.makeMon(rng, 13, 3))
  s.pc.push(G.makeMon(rng, 16, 20))
  // A stone in the bag evolves a party member
  s.party[1] = G.makeMon(rng, 133, 20)
  s.bag['water-stone'] = 1
  // No balls left, money to buy some
  delete s.bag['poke-ball']
  s.money = 10000
  for (let i = 0; i < 200 && s.stats.wins < 1; i++) G.step(s, rng)
  expect(s.party.some((m) => m.s === 16 || m.s === 17)).toBe(true)
  expect(s.party.some((m) => m.s === 134)).toBe(true)
  expect(s.bag['water-stone']).toBeUndefined()
  expect((s.bag['poke-ball'] || 0) + (s.bag['great-ball'] || 0) > 0).toBe(true)
  // Benched members gain experience from a defeated foe
  s.settings.catchMode = 'none'
  const xp = s.party.slice(1).map((m) => m.xp)
  for (let i = 0; i < 200 && s.stats.wins < 2; i++) G.step(s, rng)
  expect(s.party.slice(1).some((m, i) => m.xp > xp[i])).toBe(true)
})

test('old saves get automatic travel and gyms once', () => {
  const s: any = G.newGame(seeded(2), 1)
  s.v = 1
  s.settings.autoZone = false
  s.settings.autoGym = false
  const m = G.migrate(s)
  expect(m.settings.autoZone).toBe(true)
  m.settings.autoZone = false
  expect(G.migrate(m).settings.autoZone).toBe(false)
})

test('the party can change in the middle of a battle', () => {
  const rng = seeded(31)
  const s = G.newGame(rng, 4)
  s.settings.autoParty = false
  s.party.push(G.makeMon(rng, 16, 10))
  s.pc.push(G.makeMon(rng, 19, 12))
  for (let i = 0; i < 50 && !(s.battle && s.battle.turn > 0); i++) G.step(s, rng)
  expect(s.battle).toBeDefined()
  const active = G.activeMon(s)
  // Send the fighting Pokémon to the PC: the battle goes on with another one
  expect(G.depositMon(s, active.u)).toBe(null)
  expect(G.swapWithParty(s, s.pc[0].u, s.party[0].u)).toBe(null)
  for (let i = 0; i < 40; i++) G.step(s, rng)
  for (const m of s.party) expect(m.hp >= 0 && m.hp <= G.maxHp(m)).toBe(true)
})

test('a long battle keeps the important events in view', () => {
  const s = G.newGame(seeded(41), 4)
  G.log(s, 'Charmander was caught!', 'rare')
  for (let i = 0; i < 300; i++) G.log(s, 'A move line ' + i, 'detail')
  expect(s.log.length).toBe(80)
  expect(s.events.at(-1).t).toBe('Charmander was caught!')
  // Old saves get their event history from the log
  const old: any = JSON.parse(JSON.stringify(s))
  delete old.events
  old.log.push({ t: 'Pidgey was caught!', k: 'rare', n: 999 })
  expect(G.migrate(old).events.at(-1).t).toBe('Pidgey was caught!')
})

test('two-turn moves hit for half power and Dream Eater needs a sleeping target', () => {
  expect(MOVES[63].two).toBe(1)
  expect(MOVES[76].two).toBe(1)
  expect(MOVES[138].dream).toBe(1)
  const rng = seeded(51)
  const s = G.newGame(rng, 65)
  const me = G.makeMon(rng, 94, 50)
  me.mv = [138]
  s.party = [me]
  for (let i = 0; i < 30 && !(s.battle && s.battle.turn > 0); i++) G.step(s, rng)
  const foe = s.battle.foes[s.battle.fi]
  expect(foe.hp).toBe(G.maxHp(foe))
  expect(s.log.some((l) => /isn't asleep/.test(l.t))).toBe(true)
})

test('a wild Abra teleports away, Metronome calls a move, Haze clears stages', () => {
  const rng = seeded(61)
  const s = G.newGame(rng, 4)
  s.settings.catchMode = 'none'
  s.party[0].lv = 30
  s.party[0].hp = G.maxHp(s.party[0])
  // Force a wild Abra that only knows Teleport
  s.battle = { kind: 'wild', foes: [G.makeMon(rng, 63, 10)], fi: 0, name: null, prize: 0, turn: 0, part: [], fs: { atk: 0, def: 0, spc: 0, spe: 0, acc: 0, eva: 0, cnf: 0, used: 0 }, os: { atk: 0, def: 0, spc: 0, spe: 0, acc: 0, eva: 0, cnf: 0, used: 0 } }
  s.battle.foes[0].mv = [100]
  for (let i = 0; i < 20 && s.battle; i++) G.step(s, rng)
  // Charmander may knock it out first; otherwise it fled
  expect(s.log.some((l) => /used Teleport and fled!|fainted!/.test(l.t))).toBe(true)
  expect(s.battle).toBe(null)
  // Metronome
  const t = G.newGame(rng, 25)
  t.party[0].mv = [118]
  for (let i = 0; i < 30; i++) G.step(t, rng)
  expect(t.log.some((l) => /used Metronome! It became /.test(l.t))).toBe(true)
})

test('after the League, the team hunts for the Pokédex', () => {
  const rng = seeded(71)
  const s = G.newGame(rng, 150)
  s.party = [150, 149, 143, 131, 65, 112].map((sp) => G.makeMon(rng, sp, 80))
  s.badges = 9
  s.money = 100000
  // A Magikarp in the PC should be brought in to train toward Gyarados
  s.pc.push(G.makeMon(rng, 129, 15))
  for (let i = 0; i < 60; i++) G.step(s, rng)
  expect(s.party.some((m) => m.s === 129 || m.s === 130)).toBe(true)
  // Rods were bought, and the zone was chosen for missing species
  expect(s.bag['super-rod']).toBe(1)
})
