// Random steps interleaved with random player actions; checks invariants
import * as G from '../pokeidle/hooks/game/engine.js'
let seed = Number(process.argv[2] || 1)
const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rng() * a.length)]
let errors = 0
for (let game = 0; game < 20; game++) {
  let s = G.newGame(rng, pick([1, 4, 7, 25]))
  s.money = 50000
  for (let i = 0; i < 3000; i++) {
    try {
      if (rng() < 0.08) {
        const all = [...s.party, ...s.pc]
        const m = pick(all)
        const item = pick(Object.keys(G.ITEMS))
        const a = pick(['lead', 'up', 'dep', 'wd', 'swap', 'rel', 'use', 'buy', 'sell', 'zone', 'gym', 'center', 'evo', 'dupes', 'json'])
        if (a === 'lead') G.makeLead(s, m.u)
        if (a === 'up') G.movePartyMon(s, m.u, rng() < 0.5 ? -1 : 1)
        if (a === 'dep') G.depositMon(s, m.u)
        if (a === 'wd') G.withdrawMon(s, m.u)
        if (a === 'swap' && s.pc.length) G.swapWithParty(s, pick(s.pc).u, pick(s.party).u)
        if (a === 'rel' && all.length > 3) G.releaseMon(s, m.u)
        if (a === 'use') G.useItem(s, item, m.u)
        if (a === 'buy') G.buy(s, item, 1)
        if (a === 'sell') G.sell(s, item)
        if (a === 'zone') G.setZone(s, pick(G.ZONES).id)
        if (a === 'gym') G.challengeGym(s)
        if (a === 'center') G.visitCenter(s)
        if (a === 'evo') G.toggleEvolution(s, m.u)
        if (a === 'dupes') G.releaseDuplicates(s)
        if (a === 'json') s = G.migrate(JSON.parse(JSON.stringify(s)))
      }
      G.step(s, rng)
      // Invariants
      if (!s.party.length) throw new Error('empty party')
      if (s.party.length > 6) throw new Error('party > 6')
      for (const m of [...s.party, ...s.pc]) {
        if (!(m.hp >= 0 && m.hp <= G.maxHp(m))) throw new Error('hp out of range ' + m.hp + '/' + G.maxHp(m))
        if (!(m.lv >= 1 && m.lv <= 100)) throw new Error('level ' + m.lv)
        if (!m.mv.length || m.mv.length > 4) throw new Error('moves ' + m.mv.length)
      }
      if (s.money < 0 || !Number.isFinite(s.money)) throw new Error('money ' + s.money)
      for (const [k, v] of Object.entries(s.bag)) if (!(v > 0)) throw new Error('bag ' + k + '=' + v)
      if (s.battle && !s.battle.foes[s.battle.fi]) throw new Error('battle without foe')
      const uids = [...s.party, ...s.pc].map((m) => m.u)
      if (new Set(uids).size !== uids.length) throw new Error('duplicate uid')
    } catch (e) {
      errors++
      if (errors < 6) console.log('game', game, 'step', i, e.stack.split('\n').slice(0, 3).join(' | '))
      break
    }
  }
}
console.log('errors', errors)
