// The PokeIdle game engine: pure functions over a plain JSON state, no mods API.
// Every function that needs randomness takes `rng`, a function returning [0, 1).

import { SPECIES, MOVES, ZONES, CHART, TYPES } from '../data/gen1.js'
import { ITEMS, GIFT_SHOP, GYMS, TRAINER_CLASSES, PICKUP } from './items.js'

export const VERSION = 2
export const MAX_PARTY = 6
export const MAX_LEVEL = 100
const LOG_LINES = 80
const SHINY_ODDS = 1024
const TRAINER_EVERY = 8
const STATIC_ODDS = 120
export const MAX_PC = 600

// ---------- small helpers ----------

const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
export const speciesName = (s) => SPECIES[s].n
export const monName = (m) => m.nk || SPECIES[m.s].n
export const typeName = (t) => TYPES[t]

function pickWeighted(rng, list, weightOf) {
  const total = list.reduce((a, x) => a + weightOf(x), 0)
  let r = rng() * total
  for (const x of list) {
    r -= weightOf(x)
    if (r < 0) return x
  }
  return list[list.length - 1]
}

// Two logs: every line of the battle, short-lived, and the events that matter,
// which a long battle must not push out of view
const EVENT_LINES = 30

export function log(state, text, kind = 'info') {
  const line = { t: text, k: kind, n: ++state.logSeq }
  state.log.push(line)
  if (state.log.length > LOG_LINES) state.log.splice(0, state.log.length - LOG_LINES)
  if (kind === 'detail') return
  state.events.push(line)
  if (state.events.length > EVENT_LINES) state.events.splice(0, state.events.length - EVENT_LINES)
}

// ---------- experience and stats ----------

export function expForLevel(growth, n) {
  if (n <= 1) return 0
  const n3 = n * n * n
  switch (growth) {
    case 1: return Math.floor((5 * n3) / 4)
    case 3: return Math.floor((4 * n3) / 5)
    case 4: return Math.max(0, Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140))
    default: return n3
  }
}

export function hpDv(dv) {
  return ((dv[0] & 1) << 3) | ((dv[1] & 1) << 2) | ((dv[2] & 1) << 1) | (dv[3] & 1)
}

// Gen 1 stat formula without stat experience: [hp, atk, def, spc, spe]
export function statsOf(mon) {
  const b = SPECIES[mon.s].b
  const L = mon.lv
  const calc = (base, dv) => Math.floor(((base + dv) * 2 * L) / 100)
  return {
    hp: calc(b[0], hpDv(mon.dv)) + L + 10,
    atk: calc(b[1], mon.dv[0]) + 5,
    def: calc(b[2], mon.dv[1]) + 5,
    spc: calc(b[3], mon.dv[3]) + 5,
    spe: calc(b[4], mon.dv[2]) + 5,
  }
}

export const maxHp = (mon) => statsOf(mon).hp

// The last four moves a species knows at a level, as Gen 1 gives wild Pokémon
export function movesAt(s, lv) {
  const learned = []
  for (const [l, id] of SPECIES[s].m) {
    if (l <= lv && !learned.includes(id)) learned.push(id)
  }
  const moves = learned.slice(-4)
  return moves.length ? moves : [33]
}

let uidSeq = 0
export function makeMon(rng, s, lv, extra = {}) {
  const dv = [ri(rng, 0, 15), ri(rng, 0, 15), ri(rng, 0, 15), ri(rng, 0, 15)]
  const mon = {
    u: Date.now().toString(36) + (++uidSeq).toString(36) + Math.floor(rng() * 1e6).toString(36),
    s,
    lv,
    xp: expForLevel(SPECIES[s].g, lv),
    dv,
    mv: movesAt(s, lv),
    st: null,
    ...extra,
  }
  if (rng() * SHINY_ODDS < 1) mon.sh = 1
  mon.hp = maxHp(mon)
  return mon
}

// ---------- new game and migration ----------

export function newGame(rng, starter = 25, name = 'Red') {
  const state = {
    v: VERSION,
    name,
    money: 3000,
    badges: 0,
    zone: 'route-1',
    party: [],
    pc: [],
    bag: { 'poke-ball': 10, potion: 5 },
    seen: {},
    caught: {},
    battle: null,
    pendingGym: false,
    winsSinceTrainer: 0,
    log: [],
    events: [],
    logSeq: 0,
    energy: 0,
    stats: { battles: 0, wins: 0, losses: 0, caught: 0, steps: 0, toolCalls: 0, turns: 0, evolved: 0, shinies: 0, money: 0 },
    settings: {
      catchMode: 'new', // new | all | none
      ball: 'auto', // auto | poke-ball | great-ball | ultra-ball
      autoPotion: true,
      autoCenter: true,
      autoBuy: true,
      autoParty: true,
      autoStones: true,
      // An idle game has to move on by itself: travel and gyms are automatic
      autoZone: true,
      autoGym: true,
      idlePlay: false,
      speed: 'normal', // slow | normal | fast
    },
    created: Date.now(),
  }
  const mon = makeMon(rng, starter, 5, { ca: Date.now(), z: 'route-1' })
  state.party.push(mon)
  markCaught(state, starter)
  log(state, `${state.name} received ${monName(mon)}! Your adventure begins on Route 1.`, 'good')
  return state
}

export function migrate(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.party)) return null
  const fresh = newGame(() => 0.5)
  const from = state.v || 1
  // Saves from before the event log: rebuild it from the battle log
  if (!Array.isArray(state.events)) state.events = (state.log || []).filter((l) => l.k !== 'detail')
  // Fills missing fields from a new game: a migration that looks at a field has
  // to run above this line, or it sees the new game's value
  for (const k of Object.keys(fresh)) if (state[k] === undefined) state[k] = fresh[k]
  state.settings = { ...fresh.settings, ...state.settings }
  for (const old of ['band', 'spinner', 'toasts', 'autoPane']) delete state.settings[old]
  // Version 1 saves had travel and gyms off by default: turn them on once
  if (from < 2) {
    state.settings.autoZone = true
    state.settings.autoGym = true
  }
  delete state.migrated13
  state.stats = { ...fresh.stats, ...state.stats }
  state.v = VERSION
  return state
}

function markSeen(state, s) {
  state.seen[s] = 1
}
function markCaught(state, s) {
  state.seen[s] = 1
  state.caught[s] = 1
}

// ---------- zones ----------

export function unlockedZones(state) {
  return ZONES.filter((z) => z.badges <= state.badges)
}

export function zoneById(id) {
  return ZONES.find((z) => z.id === id) || ZONES[0]
}

// Species a zone offers that the player hasn't caught yet
function missingIn(state, z) {
  const ids = new Set()
  for (const m of ['walk', 'surf', 'old-rod', 'good-rod', 'super-rod']) {
    if (m.endsWith('rod') && !state.bag[m]) continue
    for (const e of z[m] || []) ids.add(e[0])
  }
  if (z.static) ids.add(z.static[0])
  let n = 0
  for (const sp of ids) if (!state.caught[sp]) n++
  return n
}

// While there are gyms to beat, train in the toughest zone the team handles.
// After the League, hunt for the Pokédex: go where the most uncaught species are.
function autoPickZone(state) {
  const lead = Math.max(...state.party.map((m) => m.lv))
  const open = unlockedZones(state)
  let best
  if (state.badges >= GYMS.length) {
    best = open.reduce((a, z) => (missingIn(state, z) > missingIn(state, a) ? z : a))
    if (!missingIn(state, best)) best = open[open.length - 1]
  } else {
    const fits = open.filter((z) => z.lv[1] <= lead + 2)
    best = fits.length ? fits[fits.length - 1] : open[0]
  }
  if (best.id !== state.zone) {
    state.zone = best.id
    log(state, `The team heads to ${best.n}.`, 'info')
  }
}

// ---------- encounters ----------

function fishingRod(state) {
  if (state.bag['super-rod']) return 'super-rod'
  if (state.bag['good-rod']) return 'good-rod'
  if (state.bag['old-rod']) return 'old-rod'
  return null
}

function wildEncounter(state, rng) {
  const z = zoneById(state.zone)
  if (z.static && !state.caught[z.static[0]] && rng() * STATIC_ODDS < 1) {
    const [s, lv] = z.static
    return { mon: makeMon(rng, s, lv), how: 'legend' }
  }
  const rod = fishingRod(state)
  const methods = []
  if (z.walk) methods.push(['walk', 70])
  if (z.surf) methods.push(['surf', z.walk ? 15 : 70])
  if (rod) {
    // A better rod only finds what its own table lists; fall back to weaker rods
    for (const r of [rod, 'good-rod', 'old-rod']) {
      if (state.bag[r] && z[r]) {
        methods.push([r, 25])
        break
      }
    }
  }
  const [method] = pickWeighted(rng, methods, (m) => m[1])
  const table = z[method]
  const [s, lo, hi] = pickWeighted(rng, table, (e) => e[3])
  return { mon: makeMon(rng, s, ri(rng, lo, hi)), how: method }
}

function startBattle(state, rng) {
  state.stats.battles++
  if (state.pendingGym) {
    state.pendingGym = false
    const gi = state.badges
    if (gi >= GYMS.length) return startWild(state, rng)
    healAll(state)
    const g = GYMS[gi]
    log(state, `${state.name} challenges the ${g.city} ${gi === 8 ? 'Elite Four' : 'Gym'}! The team was fully healed.`, 'gym')
    state.battle = { kind: 'gym', gym: gi, ti: 0, ...trainerBattle(state, rng, g.trainers[0]) }
    return
  }
  if (state.winsSinceTrainer >= TRAINER_EVERY) {
    state.winsSinceTrainer = 0
    const z = zoneById(state.zone)
    const [cls, prize] = TRAINER_CLASSES[Math.floor(rng() * TRAINER_CLASSES.length)]
    const table = z.walk || z.surf
    const n = ri(rng, 1, 3)
    const team = []
    for (let i = 0; i < n; i++) {
      const [s, , hi] = pickWeighted(rng, table, (e) => e[3])
      team.push([s, hi + ri(rng, 0, 2)])
    }
    const b = trainerBattle(state, rng, [cls, prize, team])
    state.battle = { kind: 'trainer', ...b }
    return
  }
  startWild(state, rng)
}

function trainerBattle(state, rng, [name, prize, team]) {
  const foes = team.map(([s, lv]) => makeMon(rng, s, lv))
  foes.forEach((m) => markSeen(state, m.s))
  log(state, `${name} wants to battle! (${foes.length} Pokémon)`, 'battle')
  log(state, `${name} sent out ${monName(foes[0])} Lv${foes[0].lv}!`, 'detail')
  return { foes, fi: 0, name, prize, turn: 0, part: [], fs: freshStages(), os: freshStages() }
}

function startWild(state, rng) {
  const { mon, how } = wildEncounter(state, rng)
  markSeen(state, mon.s)
  const where = how === 'walk' ? '' : how === 'surf' ? ' while surfing' : how === 'legend' ? '' : ` with the ${ITEMS[how].n}`
  const intro = how === 'legend' ? `A legendary ${monName(mon)} Lv${mon.lv} appeared!` : `A wild ${monName(mon)} Lv${mon.lv} appeared${where}!`
  log(state, (mon.sh ? 'Shiny! ' : '') + intro, mon.sh || how === 'legend' ? 'rare' : 'battle')
  state.battle = { kind: 'wild', foes: [mon], fi: 0, name: null, prize: 0, turn: 0, part: [], fs: freshStages(), os: freshStages() }
}

const freshStages = () => ({ atk: 0, def: 0, spc: 0, spe: 0, acc: 0, eva: 0, cnf: 0, used: 0 })

// ---------- battle mechanics ----------

const stageMul = (st) => (st >= 0 ? (2 + st) / 2 : 2 / (2 - st))
const accMul = (st) => (st >= 0 ? (3 + st) / 3 : 3 / (3 - st))

export function effectiveness(moveType, defender) {
  return SPECIES[defender.s].t.reduce((a, t) => a * CHART[moveType][t], 1)
}

function battleStat(mon, stages, key) {
  let v = statsOf(mon)[key] * stageMul(stages[key])
  if (key === 'spe' && mon.st === 'par') v /= 4
  if (key === 'atk' && mon.st === 'brn') v /= 2
  return Math.max(1, Math.floor(v))
}

function damage(rng, att, def, as, ds, mv, crit) {
  if (mv.fix === 'lvl') return att.lv
  if (mv.fix === 'half') return Math.max(1, Math.floor(def.hp / 2))
  if (mv.fix === 'psy') return Math.max(1, Math.floor(att.lv * (0.5 + rng())))
  if (typeof mv.fix === 'number') return mv.fix
  const phys = mv.k === 1
  const A = crit ? statsOf(att)[phys ? 'atk' : 'spc'] : battleStat(att, as, phys ? 'atk' : 'spc')
  let D = crit ? statsOf(def)[phys ? 'def' : 'spc'] : battleStat(def, ds, phys ? 'def' : 'spc')
  if (mv.boom) D = Math.max(1, Math.floor(D / 2))
  const L = att.lv * (crit ? 2 : 1)
  const power = mv.two ? Math.floor(mv.p / 2) : mv.p
  let dmg = Math.floor(Math.floor((Math.floor((2 * L) / 5 + 2) * A * power) / D) / 50) + 2
  if (SPECIES[att.s].t.includes(mv.t)) dmg = Math.floor(dmg * 1.5)
  dmg = Math.floor(dmg * effectiveness(mv.t, def))
  if (dmg === 0) return 0
  return Math.max(1, Math.floor((dmg * ri(rng, 217, 255)) / 255))
}

// How good a move looks against a target, for the AI and for learning moves
function moveScore(att, def, id, as, ds) {
  const mv = MOVES[id]
  if (mv.flee) return 0
  if (mv.metro) return 30
  if (mv.p === 0 && !mv.fix) {
    if (mv.haze) return as && ds && as.atk + as.def + as.spc < ds.atk + ds.def + ds.spc - 2 ? 15 : 0
    if (mv.ail === 'slp' || mv.ail === 'par') return def && !def.st ? 25 : 0
    if (mv.hl) return att.hp < maxHp(att) / 2 ? 40 : 0
    if (mv.st && mv.self) return as && as.used < 2 ? 12 : 0
    if (mv.st) return ds && ds.used < 2 ? 8 : 0
    return 2
  }
  if (mv.ohko) return def && def.lv <= att.lv ? 35 : 0
  const eff = def ? effectiveness(mv.t, def) : 1
  const stab = SPECIES[att.s].t.includes(mv.t) ? 1.5 : 1
  if (mv.dream && def && def.st !== 'slp') return 0
  const pow = mv.fix ? (mv.fix === 'lvl' ? att.lv : 40) : (mv.two ? mv.p / 2 : mv.p) * (mv.hits ? 3 : 1)
  const base = pow * stab * eff * ((mv.a || 100) / 100)
  return mv.boom ? base * 0.3 : base
}

function chooseMove(rng, att, def, as, ds, smart) {
  const ids = att.mv.length ? att.mv : [165]
  if (!smart) return ids[Math.floor(rng() * ids.length)]
  let best = ids[0]
  let bestScore = -1
  for (const id of ids) {
    const sc = moveScore(att, def, id, as, ds) * (0.9 + rng() * 0.2)
    if (sc > bestScore) {
      bestScore = sc
      best = id
    }
  }
  return best
}

function statusName(st) {
  return { par: 'paralyzed', slp: 'asleep', frz: 'frozen', brn: 'burned', psn: 'poisoned' }[st]
}

// One mon uses one move. Returns nothing; writes to the log.
function useMove(state, rng, att, def, as, ds, id, attLabel, defLabel, called = false) {
  const mv = MOVES[id]
  // Status conditions that stop a move; a move Metronome called already passed them
  if (!called) {
    if (att.st === 'slp') {
      att.sl = (att.sl || 1) - 1
      if (att.sl <= 0) {
        att.st = null
        log(state, `${attLabel} woke up!`, 'detail')
      } else {
        log(state, `${attLabel} is fast asleep.`, 'detail')
        return
      }
    }
    if (att.st === 'frz') {
      if (rng() < 0.2) {
        att.st = null
        log(state, `${attLabel} thawed out!`, 'detail')
      } else {
        log(state, `${attLabel} is frozen solid!`, 'detail')
        return
      }
    }
    if (att.st === 'par' && rng() < 0.25) {
      log(state, `${attLabel} is fully paralyzed!`, 'detail')
      return
    }
    if (as.cnf > 0) {
      as.cnf--
      if (rng() < 0.5) {
        const self = Math.max(1, Math.floor(maxHp(att) / 12))
        att.hp = Math.max(0, att.hp - self)
        log(state, `${attLabel} hurt itself in confusion!`, 'detail')
        return
      }
    }
    if (as.flinch) {
      as.flinch = 0
      log(state, `${attLabel} flinched!`, 'detail')
      return
    }
  }
  const name = mv.n
  if (mv.metro) {
    // Metronome calls any move but itself and Struggle
    let pick
    do pick = 1 + Math.floor(rng() * 164)
    while (pick === 118)
    log(state, `${attLabel} used Metronome! It became ${MOVES[pick].n}!`, 'detail')
    return useMove(state, rng, att, def, as, ds, pick, attLabel, defLabel, true)
  }
  if (mv.flee) {
    const b = state.battle
    if (b && b.kind === 'wild' && b.foes[b.fi] === att) {
      log(state, `${attLabel} used ${name} and fled!`)
      b.fled = 1
    } else {
      log(state, `${attLabel} used ${name}, but it failed!`, 'detail')
    }
    return
  }
  if (mv.haze) {
    for (const st of [as, ds]) for (const k of ['atk', 'def', 'spc', 'spe', 'acc', 'eva']) st[k] = 0
    log(state, `${attLabel} used Haze! All stat changes were eliminated!`, 'detail')
    return
  }
  // Accuracy check; self-targeting moves always land
  if (!mv.self && mv.a) {
    const chance = (mv.a / 100) * accMul(as.acc) / accMul(ds.eva)
    if (rng() >= Math.min(chance, 255 / 256)) {
      log(state, `${attLabel} used ${name}, but it missed!`, 'detail')
      return
    }
  }
  if (mv.ohko) {
    if (def.lv > att.lv || effectiveness(mv.t, def) === 0) {
      log(state, `${attLabel} used ${name}, but it failed!`, 'detail')
      return
    }
    def.hp = 0
    log(state, `${attLabel} used ${name}! It's a one-hit KO!`, 'detail')
    return
  }
  if (mv.dream && def.st !== 'slp') {
    log(state, `${attLabel} used ${name}, but ${defLabel} isn't asleep!`, 'detail')
    return
  }
  if (mv.p > 0 || mv.fix) {
    const eff = effectiveness(mv.t, def)
    if (eff === 0) {
      log(state, `${attLabel} used ${name}! It doesn't affect ${defLabel}...`, 'detail')
      return
    }
    const hits = mv.hits ? (mv.hits[0] === mv.hits[1] ? mv.hits[0] : pickWeighted(rng, [2, 3, 4, 5], (h) => (h <= 3 ? 3 : 1))) : 1
    let total = 0
    let crits = 0
    for (let h = 0; h < hits && def.hp > 0; h++) {
      const critRate = Math.min(255, Math.floor(SPECIES[att.s].b[4] / 2) * (mv.cr ? 8 : 1)) / 256
      const crit = !mv.fix && rng() < critRate
      if (crit) crits++
      const d = damage(rng, att, def, as, ds, mv, crit)
      total += Math.min(d, def.hp)
      def.hp = Math.max(0, def.hp - d)
    }
    let line = `${attLabel} used ${name}! ${defLabel} took ${total} damage`
    if (hits > 1) line += ` (${hits} hits)`
    line += '.'
    if (crits) line += ' Critical hit!'
    if (!mv.fix && eff > 1) line += " It's super effective!"
    if (!mv.fix && eff < 1) line += " It's not very effective..."
    log(state, line, 'detail')
    if (mv.dr && total > 0) {
      const amt = Math.max(1, Math.floor((total * Math.abs(mv.dr)) / 100))
      if (mv.dr > 0) {
        att.hp = Math.min(maxHp(att), att.hp + amt)
        log(state, `${attLabel} drained ${amt} HP.`, 'detail')
      } else {
        att.hp = Math.max(0, att.hp - amt)
        log(state, `${attLabel} is hit with recoil!`, 'detail')
      }
    }
    if (mv.boom) att.hp = 0
    if (def.hp > 0 && mv.fl && rng() * 100 < mv.fl) ds.flinch = 1
  } else {
    log(state, `${attLabel} used ${name}!`, 'detail')
  }
  // Healing moves
  if (mv.hl && mv.p === 0) {
    const max = maxHp(att)
    if (att.hp >= max) {
      log(state, `But ${attLabel}'s HP is full!`, 'detail')
    } else {
      att.hp = Math.min(max, att.hp + Math.floor((max * mv.hl) / 100))
      if (mv.rest) {
        att.st = 'slp'
        att.sl = 2
        log(state, `${attLabel} slept and became healthy!`, 'detail')
      } else {
        log(state, `${attLabel} regained health!`, 'detail')
      }
    }
  }
  // Status conditions
  if (mv.ail && def.hp > 0 && (mv.p === 0 || rng() * 100 < mv.ac)) {
    if (mv.ail === 'cnf') {
      if (!ds.cnf) {
        ds.cnf = ri(rng, 1, 4)
        log(state, `${defLabel} became confused!`, 'detail')
      }
    } else if (!def.st) {
      const immune = (mv.ail === 'brn' && SPECIES[def.s].t.includes(8)) ||
        (mv.ail === 'psn' && SPECIES[def.s].t.includes(3)) ||
        (mv.ail === 'frz' && SPECIES[def.s].t.includes(13)) ||
        (mv.ail === 'par' && mv.t === 11 && SPECIES[def.s].t.includes(4))
      if (!immune) {
        def.st = mv.ail
        if (mv.ail === 'slp') def.sl = ri(rng, 1, 7)
        log(state, `${defLabel} is ${statusName(mv.ail)}!`, 'detail')
      } else if (mv.p === 0) {
        log(state, `It doesn't affect ${defLabel}...`, 'detail')
      }
    } else if (mv.p === 0) {
      log(state, `But it failed!`, 'detail')
    }
  }
  // Stat stage changes
  if (mv.st && (mv.p === 0 || rng() * 100 < (mv.sc || 0))) {
    const target = mv.self ? as : ds
    const who = mv.self ? attLabel : defLabel
    if (mv.p === 0) as.used++
    for (const [stat, ch] of mv.st) {
      const before = target[stat]
      target[stat] = clamp(before + ch, -6, 6)
      if (target[stat] === before) log(state, `${who}'s ${stat.toUpperCase()} won't go any ${ch > 0 ? 'higher' : 'lower'}!`, 'detail')
      else log(state, `${who}'s ${stat.toUpperCase()} ${ch > 0 ? 'rose' : 'fell'}${Math.abs(ch) > 1 ? ' sharply' : ''}!`, 'detail')
    }
  }
}

function endOfTurnDamage(state, mon, label) {
  if (mon.hp > 0 && (mon.st === 'psn' || mon.st === 'brn')) {
    const d = Math.max(1, Math.floor(maxHp(mon) / 16))
    mon.hp = Math.max(0, mon.hp - d)
    log(state, `${label} is hurt by ${mon.st === 'psn' ? 'poison' : 'its burn'}!`, 'detail')
  }
}

export function activeMon(state) {
  const b = state.battle
  if (b && b.act) {
    const m = state.party.find((x) => x.u === b.act && x.hp > 0)
    if (m) return m
  }
  return state.party.find((m) => m.hp > 0) || null
}

// Picks who fights the current foe: the lead, unless another party member fares much better
function chooseActive(state) {
  const b = state.battle
  const foe = b.foes[b.fi]
  const alive = state.party.filter((m) => m.hp > 0)
  if (!alive.length) return null
  const power = (m) => Math.max(0, ...m.mv.map((id) => (MOVES[id].p || MOVES[id].fix ? moveScore(m, foe, id) : 0))) * m.lv * (0.5 + m.hp / maxHp(m) / 2)
  let best = alive[0]
  for (const m of alive) if (power(m) > power(best) * 1.6) best = m
  if (b.act !== best.u) {
    if (b.act) log(state, `${state.name} sends out ${monName(best)}!`, 'detail')
    b.act = best.u
    b.os = freshStages()
  }
  return best
}

// ---------- catching ----------

export function bestBall(state, foe) {
  const s = state.settings.ball
  if (state.bag['master-ball'] && SPECIES[foe.s].leg) return 'master-ball'
  if (s !== 'auto') return state.bag[s] ? s : null
  // Use the cheapest ball that gives a fair chance; stronger balls for rare species
  const order = SPECIES[foe.s].c < 75 || foe.sh ? ['ultra-ball', 'great-ball', 'poke-ball'] : ['poke-ball', 'great-ball', 'ultra-ball']
  return order.find((b) => state.bag[b]) || null
}

export function catchChance(foe, ball) {
  if (ball === 'master-ball') return 1
  const max = maxHp(foe)
  const rate = SPECIES[foe.s].c
  const bonus = ITEMS[ball].bonus
  const status = foe.st === 'slp' || foe.st === 'frz' ? 2 : foe.st ? 1.5 : 1
  const a = (((3 * max - 2 * foe.hp) * rate * bonus) / (3 * max)) * status
  return Math.min(1, a / 255)
}

function wantsCatch(state, foe) {
  const mode = state.settings.catchMode
  if (foe.sh || SPECIES[foe.s].leg) return mode !== 'none' || foe.sh
  if (mode === 'all') return true
  if (mode === 'new') return !state.caught[foe.s]
  return false
}

function giveMon(state, mon) {
  mon.st = null
  mon.ca = Date.now()
  mon.z = state.zone
  markCaught(state, mon.s)
  state.stats.caught++
  if (mon.sh) state.stats.shinies++
  if (state.party.length < MAX_PARTY) {
    state.party.push(mon)
    return 'party'
  }
  state.pc.push(mon)
  if (state.pc.length > MAX_PC) {
    // Make room by releasing the weakest non-shiny duplicate, or the weakest Pokémon
    const dupes = state.pc.filter((m) => !m.sh && state.pc.some((o) => o !== m && o.s === m.s))
    const pool = dupes.length ? dupes : state.pc.filter((m) => m !== mon)
    const weakest = pool.reduce((a, m) => (m.lv < a.lv ? m : a))
    state.pc.splice(state.pc.indexOf(weakest), 1)
    addMoney(state, weakest.lv * 10)
    log(state, `The PC is full: ${monName(weakest)} Lv${weakest.lv} was released.`)
  }
  return 'pc'
}

// ---------- experience, moves and evolution ----------

function learnMove(state, mon, id) {
  if (mon.mv.includes(id)) return
  const label = monName(mon)
  if (mon.mv.length < 4) {
    mon.mv.push(id)
    log(state, `${label} learned ${MOVES[id].n}!`, 'good')
    return
  }
  let worst = 0
  let worstScore = Infinity
  mon.mv.forEach((m, i) => {
    const sc = moveScore(mon, null, m)
    if (sc < worstScore) {
      worstScore = sc
      worst = i
    }
  })
  if (moveScore(mon, null, id) > worstScore) {
    const old = mon.mv[worst]
    mon.mv[worst] = id
    log(state, `${label} forgot ${MOVES[old].n} and learned ${MOVES[id].n}!`, 'good')
  }
}

export function gainXp(state, mon, amount) {
  if (mon.lv >= MAX_LEVEL || amount <= 0) return
  mon.xp += amount
  const g = SPECIES[mon.s].g
  while (mon.lv < MAX_LEVEL && mon.xp >= expForLevel(g, mon.lv + 1)) {
    const before = maxHp(mon)
    mon.lv++
    if (mon.hp > 0) mon.hp += maxHp(mon) - before
    log(state, `${monName(mon)} grew to Lv${mon.lv}!`, 'good')
    for (const [l, id] of SPECIES[mon.s].m) if (l === mon.lv) learnMove(state, mon, id)
    const evo = (SPECIES[mon.s].e || []).find((e) => e.lvl && mon.lv >= e.lvl)
    if (evo && !mon.noEvo) mon.pe = evo.to
  }
  if (mon.lv >= MAX_LEVEL) mon.xp = expForLevel(g, MAX_LEVEL)
}

export function evolve(state, mon, to) {
  const from = monName(mon)
  const fromName = SPECIES[mon.s].n
  const ratio = mon.hp / maxHp(mon)
  mon.s = to
  if (mon.nk === fromName) delete mon.nk
  mon.hp = Math.max(mon.hp > 0 ? 1 : 0, Math.round(maxHp(mon) * ratio))
  delete mon.pe
  markCaught(state, to)
  state.stats.evolved++
  log(state, `What? ${from} is evolving... Congratulations! It evolved into ${SPECIES[to].n}!`, 'rare')
  for (const [l, id] of SPECIES[to].m) if (l === mon.lv) learnMove(state, mon, id)
}

function applyPendingEvolutions(state) {
  for (const m of [...state.party, ...state.pc]) if (m.pe && !m.noEvo) evolve(state, m, m.pe)
}

function xpYield(foe, trainer) {
  // Half the Gen 1 yield: an idle team fights far more battles than a player would
  return Math.max(1, Math.floor(((SPECIES[foe.s].x * foe.lv) / 14) * (trainer ? 1.5 : 1)))
}

// ---------- healing ----------

export function healAll(state) {
  for (const m of state.party) {
    m.hp = maxHp(m)
    m.st = null
    delete m.sl
  }
}

function pokemonCenter(state) {
  state.stats.centers = (state.stats.centers || 0) + 1
  healAll(state)
  log(state, 'The team rested at the Pokémon Center. Everyone is fully healed!', 'detail')
}

function bestPotion(state, mon) {
  const missing = maxHp(mon) - mon.hp
  const potions = ['potion', 'super-potion', 'hyper-potion', 'max-potion', 'full-restore'].filter((p) => state.bag[p])
  return potions.find((p) => ITEMS[p].heal >= missing) || potions[potions.length - 1] || null
}

// ---------- the main loop: one step ----------

// Advances the game by one step: starts a battle, plays one turn, or wraps one up.
// Restocks Poké Balls when they run out, if catching is on and money allows
function restockBalls(state) {
  if (state.settings.catchMode === 'none' || !state.settings.autoBuy) return
  const balls = ['poke-ball', 'great-ball', 'ultra-ball'].reduce((a, k) => a + (state.bag[k] || 0), 0)
  if (balls > 0) return
  const ball = state.badges >= 3 ? 'ultra-ball' : state.badges >= 1 ? 'great-ball' : 'poke-ball'
  const n = Math.min(10, Math.floor((state.money * 0.25) / ITEMS[ball].price))
  if (n < 1) return
  state.money -= n * ITEMS[ball].price
  state.bag[ball] = n
  log(state, `Bought ${n} ${ITEMS[ball].n}s at the Poké Mart.`)
}

export function step(state, rng) {
  state.stats.steps++
  if (!state.party.length) return
  if (!state.battle) {
    restockBalls(state)
    if (state.settings.autoCenter) {
      const hurt = state.party.some((m) => m.hp === 0 || m.hp < maxHp(m) * 0.5 || m.st)
      if (hurt) {
        pokemonCenter(state)
        return
      }
    }
    if (!activeMon(state)) {
      pokemonCenter(state)
      return
    }
    if (state.settings.autoGym && !state.pendingGym && state.badges < GYMS.length) {
      const ace = Math.max(...GYMS[state.badges].trainers.at(-1)[2].map((t) => t[1]))
      // The whole team should be ready, not only its strongest member
      const team = state.party.slice().sort((x, y) => y.lv - x.lv).slice(0, 3)
      const ready = team.reduce((a, m) => a + m.lv, 0) / team.length
      if (ready >= ace && ready >= (state.gymRetry || 0)) state.pendingGym = true
    }
    if (state.settings.autoZone && !state.pendingGym) autoPickZone(state)
    startBattle(state, rng)
    return
  }
  playTurn(state, rng)
}

function playTurn(state, rng) {
  const b = state.battle
  const foe = b.foes[b.fi]
  if (b.turn === 0 || !activeMon(state) || activeMon(state).u !== b.act) chooseActive(state)
  let me = activeMon(state)
  if (!me) return loseBattle(state)
  b.turn++
  if (!b.part.includes(me.u)) b.part.push(me.u)
  const foeLabel = (b.kind === 'wild' ? 'Wild ' : 'Foe ') + monName(foe)
  const meLabel = monName(me)

  // Catch attempt, before the turn's attacks
  if (b.kind === 'wild' && wantsCatch(state, foe)) {
    const ball = bestBall(state, foe)
    const est = Math.max(...me.mv.map((id) => (MOVES[id].p ? moveScore(me, foe, id) : 0)))
    const weak = foe.hp <= maxHp(foe) * 0.5 || est * me.lv * 0.02 >= foe.hp || ball === 'master-ball' || b.turn > 6
    if (ball && weak) {
      state.bag[ball]--
      if (!state.bag[ball]) delete state.bag[ball]
      if (rng() < catchChance(foe, ball)) {
        const where = giveMon(state, foe)
        log(state, `${state.name} threw a ${ITEMS[ball].n}... Gotcha! ${monName(foe)} was caught!${where === 'pc' ? ' (sent to the PC)' : ''}`, 'rare')
        state.battle = null
        state.stats.wins++
        manageTeam(state)
        return
      }
      log(state, `${state.name} threw a ${ITEMS[ball].n}... Oh no! The Pokémon broke free!`, 'detail')
      foeAttack(state, rng, me, foe, meLabel, foeLabel)
      return afterTurn(state, rng)
    }
  }

  // Potion, when the active Pokémon is in danger
  if (state.settings.autoPotion && me.hp < maxHp(me) * 0.25 && foe.hp > maxHp(foe) * 0.3) {
    const p = bestPotion(state, me)
    if (p) {
      useItemOn(state, p, me)
      foeAttack(state, rng, me, foe, meLabel, foeLabel)
      return afterTurn(state, rng)
    }
  }

  const myMove = chooseMove(rng, me, foe, b.os, b.fs, true)
  const foeMove = chooseMove(rng, foe, me, b.fs, b.os, b.kind !== 'wild' && rng() < 0.6)
  const mySpe = battleStat(me, b.os, 'spe') + (MOVES[myMove].pr || 0) * 10000
  const foeSpe = battleStat(foe, b.fs, 'spe') + (MOVES[foeMove].pr || 0) * 10000
  const meFirst = mySpe > foeSpe || (mySpe === foeSpe && rng() < 0.5)
  const order = meFirst
    ? [[me, foe, b.os, b.fs, myMove, meLabel, foeLabel], [foe, me, b.fs, b.os, foeMove, foeLabel, meLabel]]
    : [[foe, me, b.fs, b.os, foeMove, foeLabel, meLabel], [me, foe, b.os, b.fs, myMove, meLabel, foeLabel]]
  for (const [att, def, as, ds, id, al, dl] of order) {
    if (att.hp <= 0 || def.hp <= 0 || b.fled) continue
    useMove(state, rng, att, def, as, ds, id, al, dl)
  }
  b.os.flinch = 0
  b.fs.flinch = 0
  endOfTurnDamage(state, me, meLabel)
  endOfTurnDamage(state, foe, foeLabel)
  afterTurn(state, rng)
}

function foeAttack(state, rng, me, foe, meLabel, foeLabel) {
  const b = state.battle
  const id = chooseMove(rng, foe, me, b.fs, b.os, b.kind !== 'wild')
  useMove(state, rng, foe, me, b.fs, b.os, id, foeLabel, meLabel)
}

function afterTurn(state, rng) {
  const b = state.battle
  if (!b) return
  if (b.fled) {
    state.battle = null
    state.winsSinceTrainer++
    return
  }
  const foe = b.foes[b.fi]
  const me = activeMon(state)
  // Our side first: a fainted active Pokémon is replaced
  for (const m of state.party) {
    if (m.hp === 0 && !m.fainted) {
      m.fainted = 1
      m.st = null
      log(state, `${monName(m)} fainted!`, 'detail')
    }
  }
  if (foe.hp === 0) {
    log(state, `${(b.kind === 'wild' ? 'Wild ' : 'Foe ') + monName(foe)} fainted!`, 'detail')
    shareXp(state, foe, b)
    b.part = []
    if (b.fi + 1 < b.foes.length) {
      b.fi++
      b.fs = freshStages()
      log(state, `${b.name} sent out ${monName(b.foes[b.fi])} Lv${b.foes[b.fi].lv}!`, 'detail')
      chooseActive(state)
      return
    }
    return winBattle(state, rng)
  }
  if (!me) return loseBattle(state)
  if (b.act && !state.party.some((m) => m.u === b.act && m.hp > 0)) {
    chooseActive(state)
    log(state, `Go! ${monName(activeMon(state))}!`, 'detail')
  }
}

function shareXp(state, foe, b) {
  const total = xpYield(foe, b.kind !== 'wild')
  const fighters = state.party.filter((m) => b.part.includes(m.u) && m.hp > 0)
  const share = fighters.length ? Math.max(1, Math.floor(total / fighters.length)) : 0
  for (const m of fighters) {
    if (m.lv < MAX_LEVEL) log(state, `${monName(m)} gained ${share} EXP.`, 'detail')
    gainXp(state, m, share)
  }
  // The bench learns by watching: a third of the experience, all of it with Exp. All
  const bench = state.bag['exp-all'] ? 1 : 1 / 3
  for (const m of state.party) if (!fighters.includes(m) && m.hp > 0) gainXp(state, m, Math.max(1, Math.floor(total * bench)))
}

function addMoney(state, amount) {
  state.money += amount
  state.stats.money += amount
}

function winBattle(state, rng) {
  const b = state.battle
  state.stats.wins++
  for (const m of state.party) delete m.fainted
  const mult = state.bag['amulet-coin'] ? 2 : 1
  if (b.kind === 'wild') {
    state.winsSinceTrainer++
    const coins = Math.floor(b.foes[0].lv * 2 * mult)
    addMoney(state, coins)
    log(state, `Defeated wild ${monName(b.foes[0])}. +₽${coins}`, 'win')
    log(state, `The team found ₽${coins} after the battle.`, 'detail')
    if (rng() < 0.04) pickup(state, rng)
  } else {
    const last = b.foes[b.foes.length - 1]
    const prize = b.prize * last.lv * mult
    addMoney(state, prize)
    log(state, `${state.name} defeated ${b.name}! Got ₽${prize} for winning!`, 'good')
    if (b.kind === 'gym') {
      const g = GYMS[b.gym]
      if (b.ti + 1 < g.trainers.length) {
        b.ti++
        Object.assign(b, trainerBattle(state, rng, g.trainers[b.ti]))
        applyPendingEvolutions(state)
        return
      }
      state.badges = Math.max(state.badges, b.gym + 1)
      state.gymRetry = 0
      if (b.gym === 8) {
        state.bag['master-ball'] = (state.bag['master-ball'] || 0) + 1
        log(state, `${state.name} is the new Pokémon League Champion! Received a Master Ball!`, 'rare')
      } else {
        log(state, `${state.name} received the ${g.badge}! New zones and Mart items unlocked.`, 'rare')
      }
    } else {
      pickup(state, rng)
    }
  }
  state.battle = null
  applyPendingEvolutions(state)
  manageTeam(state)
  shopForDex(state, rng)
}

// Between battles: swap the weakest benched party member for a stronger PC
// Pokémon, and use evolution stones the bag holds. The lead stays where it is.
// Money turns into Pokédex progress once the team has plenty: rods, special
// Pokémon, and the stones or Link Cable that reach a species still missing.
// It spends only above a reserve, so balls and potions stay affordable.
const SHOP_RESERVE = 5000

function spend(state, price) {
  if (state.money - price < SHOP_RESERVE) return false
  state.money -= price
  return true
}

function shopForDex(state, rng) {
  if (!state.settings.autoBuy) return
  for (const rod of ['old-rod', 'good-rod', 'super-rod']) {
    const it = ITEMS[rod]
    if (!state.bag[rod] && it.badge <= state.badges && spend(state, it.price)) {
      state.bag[rod] = 1
      log(state, `Bought the ${it.n}. The team can fish now.`, 'good')
      return
    }
  }
  // An evolution that reaches a missing species, through a stone or the Link Cable
  for (const m of [...state.pc, ...state.party]) {
    if (m.noEvo) continue
    const evo = (SPECIES[m.s].e || []).find((e) => e.item && !state.caught[e.to])
    if (!evo) continue
    if (!state.bag[evo.item]) {
      if (ITEMS[evo.item].badge > state.badges || !spend(state, ITEMS[evo.item].price)) continue
      state.bag[evo.item] = 1
    }
    if (evo.item !== 'link-cable') {
      state.bag[evo.item]--
      if (!state.bag[evo.item]) delete state.bag[evo.item]
    }
    evolve(state, m, evo.to)
    return
  }
  // A special Pokémon the player hasn't caught
  const wanted = (sp) => !state.caught[sp] || (SPECIES[sp].e || []).some((e) => !state.caught[e.to])
  const owned = (sp) => [...state.party, ...state.pc].some((m) => m.s === sp)
  const gi = GIFT_SHOP.findIndex((g) => g.badge <= state.badges && g.s !== 151 && wanted(g.s) && !owned(g.s) && state.money - g.price >= SHOP_RESERVE)
  if (gi >= 0) buyGift(state, gi, rng)
}

// After the League, Pokémon that evolve by level into a missing species train in
// the party: the long tail of the Pokédex
function trainee(state) {
  if (state.badges < GYMS.length) return null
  return state.pc
    .filter((m) => !m.noEvo && (SPECIES[m.s].e || []).some((e) => e.lvl && !state.caught[e.to]))
    .sort((a, b) => b.lv - a.lv)[0] || null
}

function manageTeam(state) {
  const t = state.settings.autoParty && trainee(state)
  if (t && state.party.length >= 2) {
    // Swap out a benched member that isn't itself training toward a missing species
    const training = (m) => (SPECIES[m.s].e || []).some((e) => e.lvl && !state.caught[e.to])
    const out = state.party.slice(1).filter((m) => !training(m)).sort((a, b) => a.lv - b.lv)[0]
    if (out) {
      t.hp = maxHp(t)
      t.st = null
      state.party[state.party.indexOf(out)] = t
      state.pc[state.pc.indexOf(t)] = out
      log(state, `${monName(t)} joined the party to train toward an evolution.`)
    }
  }
  if (state.settings.autoParty && state.pc.length && state.party.length && !t) {
    const benched = state.party.slice(1)
    if (state.party.length < MAX_PARTY) {
      const best = state.pc.reduce((a, m) => (m.lv > a.lv ? m : a))
      state.pc.splice(state.pc.indexOf(best), 1)
      best.hp = maxHp(best)
      best.st = null
      state.party.push(best)
      log(state, `${monName(best)} joined the party from the PC.`)
    } else if (benched.length) {
      const weak = benched.reduce((a, m) => (m.lv < a.lv ? m : a))
      const best = state.pc.reduce((a, m) => (m.lv > a.lv ? m : a))
      if (best.lv >= weak.lv + 3 && !weak.keep) {
        best.hp = maxHp(best)
        best.st = null
        state.party[state.party.indexOf(weak)] = best
        state.pc[state.pc.indexOf(best)] = weak
        log(state, `${monName(best)} Lv${best.lv} took ${monName(weak)}'s place in the party.`)
      }
    }
  }
  if (state.settings.autoStones) {
    for (const m of state.party) {
      if (m.noEvo) continue
      const evo = (SPECIES[m.s].e || []).find((e) => e.item && state.bag[e.item] && e.item !== 'link-cable')
      if (!evo) continue
      state.bag[evo.item]--
      if (!state.bag[evo.item]) delete state.bag[evo.item]
      evolve(state, m, evo.to)
    }
  }
}

function pickup(state, rng) {
  const pool = PICKUP.filter((p) => p[2] <= state.badges)
  const [item] = pickWeighted(rng, pool, (p) => p[1])
  state.bag[item] = (state.bag[item] || 0) + 1
  log(state, `The team found a ${ITEMS[item].n}!`, 'good')
}

function loseBattle(state) {
  const b = state.battle
  state.stats.losses++
  const lost = Math.floor(state.money / 4)
  state.money -= lost
  for (const m of state.party) delete m.fainted
  if (b && b.kind === 'gym') {
    const team = state.party.slice().sort((x, y) => y.lv - x.lv).slice(0, 3)
    state.gymRetry = Math.round(team.reduce((a, m) => a + m.lv, 0) / team.length) + 3
    log(state, `${state.name} lost to ${b.name}... The team will train to Lv${state.gymRetry} before trying again.`, 'bad')
  }
  log(state, `${state.name} is out of usable Pokémon! Lost ₽${lost} and hurried to the Pokémon Center.`, 'bad')
  state.battle = null
  healAll(state)
}

// ---------- player actions ----------

export function findMon(state, uid) {
  const pi = state.party.findIndex((m) => m.u === uid)
  if (pi >= 0) return { mon: state.party[pi], where: 'party', i: pi }
  const ci = state.pc.findIndex((m) => m.u === uid)
  if (ci >= 0) return { mon: state.pc[ci], where: 'pc', i: ci }
  return null
}

const inBattle = (state, uid) => state.battle && state.party.some((m) => m.u === uid)

export function movePartyMon(state, uid, delta) {
  const i = state.party.findIndex((m) => m.u === uid)
  const j = i + delta
  if (i < 0 || j < 0 || j >= state.party.length) return 'Cannot move there.'
  ;[state.party[i], state.party[j]] = [state.party[j], state.party[i]]
  return null
}

export function makeLead(state, uid) {
  const i = state.party.findIndex((m) => m.u === uid)
  if (i <= 0) return i === 0 ? null : 'Not in the party.'
  const [m] = state.party.splice(i, 1)
  state.party.unshift(m)
  return null
}

// A party member leaves mid-battle: the battle sends out someone else next turn
function leavesParty(state, mon) {
  const b = state.battle
  if (!b) return
  if (b.act === mon.u) b.act = null
  b.part = b.part.filter((u) => u !== mon.u)
}

export function depositMon(state, uid) {
  const f = findMon(state, uid)
  if (!f || f.where !== 'party') return 'Not in the party.'
  if (state.party.length <= 1) return 'The party needs at least one Pokémon.'
  leavesParty(state, f.mon)
  state.party.splice(f.i, 1)
  delete f.mon.fainted
  state.pc.unshift(f.mon)
  log(state, `${monName(f.mon)} was sent to the PC.`)
  return null
}

export function withdrawMon(state, uid) {
  const f = findMon(state, uid)
  if (!f || f.where !== 'pc') return 'Not in the PC.'
  if (state.party.length >= MAX_PARTY) return 'The party is full. Deposit a Pokémon first.'
  state.pc.splice(f.i, 1)
  f.mon.hp = maxHp(f.mon)
  f.mon.st = null
  state.party.push(f.mon)
  log(state, `${monName(f.mon)} joined the party.`)
  return null
}

export function swapWithParty(state, pcUid, partyUid) {
  const a = findMon(state, pcUid)
  const b = findMon(state, partyUid)
  if (!a || a.where !== 'pc' || !b || b.where !== 'party') return 'Pick a PC Pokémon and a party Pokémon.'
  leavesParty(state, b.mon)
  a.mon.hp = maxHp(a.mon)
  a.mon.st = null
  state.party[b.i] = a.mon
  state.pc[a.i] = b.mon
  log(state, `${monName(a.mon)} swapped places with ${monName(b.mon)}.`)
  return null
}

export function releaseMon(state, uid) {
  const f = findMon(state, uid)
  if (!f) return 'No such Pokémon.'
  if (f.where === 'party' && state.party.length <= 1) return 'You cannot release your last Pokémon.'
  if (f.where === 'party') leavesParty(state, f.mon)
  ;(f.where === 'party' ? state.party : state.pc).splice(f.i, 1)
  const gift = f.mon.lv * 10
  addMoney(state, gift)
  log(state, `${monName(f.mon)} was released. Bye, ${monName(f.mon)}! (Prof. Oak sent ₽${gift})`)
  return null
}

export function renameMon(state, uid, name) {
  const f = findMon(state, uid)
  if (!f) return 'No such Pokémon.'
  const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12)
  if (clean && clean !== SPECIES[f.mon.s].n) f.mon.nk = clean
  else delete f.mon.nk
  return null
}

export function toggleEvolution(state, uid) {
  const f = findMon(state, uid)
  if (!f) return 'No such Pokémon.'
  f.mon.noEvo = f.mon.noEvo ? undefined : 1
  if (!f.mon.noEvo) {
    const evo = (SPECIES[f.mon.s].e || []).find((e) => e.lvl && f.mon.lv >= e.lvl)
    if (evo && !inBattle(state, uid)) evolve(state, f.mon, evo.to)
  }
  return null
}

// Which items in the bag can be used on this Pokémon
export function usableItems(state, mon) {
  return Object.keys(state.bag).filter((k) => state.bag[k] > 0 && canUse(state, k, mon) === null)
}

export function canUse(state, item, mon) {
  const it = ITEMS[item]
  if (!it || !state.bag[item]) return 'You have none.'
  const max = maxHp(mon)
  switch (it.kind) {
    case 'heal':
      if (mon.hp === 0) return 'It has fainted. Use a Revive.'
      if (mon.hp >= max && !(it.cure && mon.st)) return 'HP is already full.'
      return null
    case 'status':
      return mon.st ? null : 'It has no status problem.'
    case 'revive':
      return mon.hp === 0 ? null : 'It has not fainted.'
    case 'candy':
      return mon.lv < MAX_LEVEL ? null : 'Already at the maximum level.'
    case 'evo':
      return (SPECIES[mon.s].e || []).some((e) => e.item === item) ? null : 'It has no reaction.'
    default:
      return 'This item is used automatically.'
  }
}

function useItemOn(state, item, mon) {
  const it = ITEMS[item]
  const label = monName(mon)
  state.bag[item]--
  if (!state.bag[item]) delete state.bag[item]
  const max = maxHp(mon)
  if (it.kind === 'heal') {
    const before = mon.hp
    mon.hp = Math.min(max, mon.hp + it.heal)
    if (it.cure) mon.st = null
    log(state, `${state.name} used a ${it.n} on ${label}. Restored ${mon.hp - before} HP.`, 'detail')
  } else if (it.kind === 'status') {
    mon.st = null
    log(state, `${state.name} used a Full Heal. ${label} is cured.`)
  } else if (it.kind === 'revive') {
    mon.hp = Math.floor(max / 2)
    delete mon.fainted
    log(state, `${label} was revived!`, 'good')
  } else if (it.kind === 'candy') {
    gainXp(state, mon, expForLevel(SPECIES[mon.s].g, mon.lv + 1) - mon.xp)
    if (mon.pe && !inBattle(state, mon.u)) evolve(state, mon, mon.pe)
  } else if (it.kind === 'evo') {
    const evo = SPECIES[mon.s].e.find((e) => e.item === item)
    evolve(state, mon, evo.to)
  }
}

export function useItem(state, item, uid) {
  const f = findMon(state, uid)
  if (!f) return 'No such Pokémon.'
  const err = canUse(state, item, f.mon)
  if (err) return err
  if (ITEMS[item].kind === 'evo' && inBattle(state, uid)) return 'Wait until the current battle ends.'
  useItemOn(state, item, f.mon)
  return null
}

export function buy(state, item, qty = 1) {
  const it = ITEMS[item]
  if (!it || !it.price) return 'Not for sale.'
  if (it.badge > state.badges) return 'Not available yet. Earn more badges.'
  if (it.once && state.bag[item]) return 'You already have one.'
  const n = it.once ? 1 : qty
  const cost = it.price * n
  if (state.money < cost) return `Not enough money (₽${cost} needed).`
  state.money -= cost
  state.bag[item] = (state.bag[item] || 0) + n
  log(state, `Bought ${n} × ${it.n} for ₽${cost}.`)
  return null
}

export function sell(state, item) {
  const it = ITEMS[item]
  if (!it || !state.bag[item] || it.kind === 'rod' || it.kind === 'key' || item === 'master-ball') return 'Cannot sell that.'
  state.bag[item]--
  if (!state.bag[item]) delete state.bag[item]
  const gain = Math.floor(it.price / 2)
  state.money += gain
  log(state, `Sold a ${it.n} for ₽${gain}.`)
  return null
}

export function buyGift(state, idx, rng) {
  const g = GIFT_SHOP[idx]
  if (!g) return 'No such offer.'
  if (g.badge > state.badges) return 'Not available yet. Earn more badges.'
  if (state.money < g.price) return `Not enough money (₽${g.price} needed).`
  if (g.s === 151 && state.caught[151]) return 'The truck is empty now.'
  state.money -= g.price
  const mon = makeMon(rng, g.s, g.lv)
  const where = giveMon(state, mon)
  log(state, `${state.name} got ${monName(mon)} Lv${g.lv} (${g.from})!${where === 'pc' ? ' It was sent to the PC.' : ''}`, 'rare')
  return null
}

export function setZone(state, id) {
  const z = ZONES.find((x) => x.id === id)
  if (!z) return 'No such zone.'
  if (z.badges > state.badges) return `Needs ${z.badges} badge(s).`
  state.zone = id
  state.settings.autoZone = false
  if (state.battle && state.battle.kind === 'wild') state.battle = null
  log(state, `The team travels to ${z.n}.`)
  return null
}

export function challengeGym(state) {
  if (state.badges >= GYMS.length) return 'You are already the Champion! Keep training.'
  state.pendingGym = true
  if (state.battle && state.battle.kind === 'wild') state.battle = null
  log(state, `${state.name} heads to the ${GYMS[state.badges].city} ${state.badges === 8 ? 'Pokémon League' : 'Gym'}...`, 'gym')
  return null
}

export function visitCenter(state) {
  if (state.battle && state.battle.kind !== 'wild') return 'Finish the trainer battle first.'
  if (state.battle) {
    log(state, 'The team ran away to the Pokémon Center.')
    state.battle = null
  }
  pokemonCenter(state)
  return null
}

// ---------- rewards from the agent's work ----------

// A finished Claude turn pays a small bonus that grows with the badges earned
export function turnBonus(state, rng, toolCalls) {
  state.stats.turns++
  const coins = (10 + toolCalls * 4) * (1 + state.badges)
  addMoney(state, coins)
  let line = `Claude finished a task: +₽${coins}`
  if (toolCalls >= 5 && rng() < 0.35) {
    const pool = PICKUP.filter((p) => p[2] <= state.badges)
    const [item] = pickWeighted(rng, pool, (p) => p[1])
    state.bag[item] = (state.bag[item] || 0) + 1
    line += ` and a ${ITEMS[item].n}`
  }
  log(state, line + '!', 'good')
}

export function dexCounts(state) {
  return { seen: Object.keys(state.seen).length, caught: Object.keys(state.caught).length }
}

export { SPECIES, MOVES, ZONES, TYPES, ITEMS, GIFT_SHOP, GYMS }

// ---------- settings and bulk actions ----------

const SETTING_VALUES = {
  catchMode: ['new', 'all', 'none'],
  ball: ['auto', 'poke-ball', 'great-ball', 'ultra-ball'],
  speed: ['slow', 'normal', 'fast'],
}

export function setSetting(state, key, value) {
  if (!SETTING_VALUES[key] || !SETTING_VALUES[key].includes(value)) return 'Unknown setting.'
  state.settings[key] = value
  return null
}

export function toggle(state, key) {
  if (typeof state.settings[key] !== 'boolean') return 'Unknown setting.'
  state.settings[key] = !state.settings[key]
  if (key === 'autoGym' && state.settings.autoGym) state.gymRetry = 0
  return null
}

// Keeps the best of each species (party included) and every shiny; releases the rest of the PC
export function releaseDuplicates(state) {
  const score = (m) => m.lv * 100 + m.dv.reduce((a, b) => a + b, 0)
  const best = {}
  for (const m of [...state.party, ...state.pc]) if (!best[m.s] || score(m) > score(best[m.s])) best[m.s] = m
  const keep = state.pc.filter((m) => m.sh || best[m.s] === m)
  const gone = state.pc.length - keep.length
  if (!gone) return 'No duplicates to release.'
  const money = state.pc.filter((m) => !keep.includes(m)).reduce((a, m) => a + m.lv * 10, 0)
  state.pc = keep
  addMoney(state, money)
  log(state, `Released ${gone} duplicate Pokémon. Prof. Oak sent ₽${money}.`)
  return null
}
