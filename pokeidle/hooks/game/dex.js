// Where each species can be found, for the Pokédex.

import { SPECIES, ZONES } from '../data/gen1.js'
import { GIFT_SHOP, ITEMS } from './items.js'

const METHOD = { walk: 'grass', surf: 'surf', 'old-rod': 'Old Rod', 'good-rod': 'Good Rod', 'super-rod': 'Super Rod' }

let cache = null

function build() {
  const where = Array.from({ length: 152 }, () => [])
  for (const z of ZONES) {
    for (const m of Object.keys(METHOD)) {
      for (const [s, lo, hi] of z[m] || []) where[s].push(`${z.n} (${METHOD[m]}, Lv${lo}-${hi})`)
    }
    if (z.static) where[z.static[0]].push(`${z.n} (rare, Lv${z.static[1]})`)
  }
  for (const g of GIFT_SHOP) where[g.s].push(`Mart: ${g.from} (₽${g.price})`)
  for (let s = 1; s <= 151; s++) {
    for (const e of SPECIES[s].e || []) {
      const how = e.lvl ? `Lv${e.lvl}` : ITEMS[e.item].n
      where[e.to].push(`Evolve ${SPECIES[s].n} (${how})`)
    }
  }
  return where
}

export function foundAt(s) {
  if (!cache) cache = build()
  return cache[s]
}

export function evolutionText(s) {
  const evos = SPECIES[s].e || []
  if (!evos.length) return 'Does not evolve'
  return evos.map((e) => `${SPECIES[e.to].n} at ${e.lvl ? 'Lv' + e.lvl : ITEMS[e.item].n}`).join(', ')
}
