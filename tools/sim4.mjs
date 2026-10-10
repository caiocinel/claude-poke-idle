// Pokédex completion after the League, in hours of Claude work
import * as G from '../pokeidle/hooks/game/engine.js'
const s = G.newGame(Math.random, Number(process.argv[2] || 4))
for (let i = 0; i < 40000; i++) {
  G.step(s, Math.random)
  if (i % 4000 === 0) console.log(((i * 5) / 3600).toFixed(0) + 'h', 'badges', s.badges, 'dex', G.dexCounts(s).caught, 'zone', s.zone, '₽' + s.money)
}
