// Hours of Claude work (5 s per step) until each badge, default settings
import * as G from '../poke-idle-cc/hooks/game/engine.js'
for (const starter of [1, 4, 7, 25]) {
  const s = G.newGame(Math.random, starter)
  const at = []
  let gymLosses = 0
  for (let i = 0; i < 12000 && s.badges < 9; i++) {
    const before = s.badges
    const lostBefore = s.stats.losses
    const gym = s.battle && s.battle.kind === 'gym'
    G.step(s, Math.random)
    if (gym && s.stats.losses > lostBefore) gymLosses++
    if (s.badges > before) at.push(((i * 5) / 3600).toFixed(1))
  }
  console.log(G.SPECIES[starter].n.padEnd(11), 'hours per badge:', at.join(' '), '| gym losses', gymLosses, '| dex', G.dexCounts(s).caught)
}
