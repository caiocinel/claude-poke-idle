// Which species a long game never catches
import * as G from '../poke-idle-cc/hooks/game/engine.js'
const s = G.newGame(Math.random, Number(process.argv[2] || 4))
for (let i = 0; i < 25000; i++) G.step(s, Math.random)
const miss = []
for (let i = 1; i <= 151; i++) if (!s.caught[i]) miss.push(i + ':' + G.SPECIES[i].n)
console.log('dex', G.dexCounts(s).caught, 'missing', miss.join(' '))
console.log('pc has', new Set(s.pc.map(m => m.s)).size, 'species; noEvo', s.pc.filter(m => m.noEvo).length)
