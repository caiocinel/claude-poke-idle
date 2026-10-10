// Default settings, like a real player who never opens the menu
import * as G from '../pokeidle/hooks/game/engine.js'
let seed = Number(process.argv[3] || 5)
// mulberry32: a seeded generator good enough for shiny odds
const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const s = G.newGame(rng, Number(process.argv[4] || 4))
const N = Number(process.argv[2] || 3000)
for (let i = 0; i < N; i++) G.step(s, rng)
console.log('steps', N, 'zone', s.zone, 'badges', s.badges, 'money', s.money)
console.log('party', s.party.map(m => G.monName(m) + ':' + m.lv).join(' '), 'pc', s.pc.length)
console.log(JSON.stringify(s.stats))
console.log(JSON.stringify(s.bag))
console.log(s.log.filter(l => l.k !== 'detail').slice(-12).map(l => l.t).join('\n'))
