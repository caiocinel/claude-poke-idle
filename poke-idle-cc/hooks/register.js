// PokeIdle: an idle Pokémon (Gen 1) adventure that plays while Claude works.
//
// Claude's work drives the game: while a turn runs, the team battles at a calm
// pace. A finished turn pays a bonus that grows with the tool calls it made.
//
// While Claude works, a five-row block under the spinner shows the battle.
// /pokeidle opens a pane on demand to manage the party, PC, bag, Mart, map and
// Pokédex. The mod draws nowhere else.

import * as G from './game/engine.js'
import { paneTree, spinnerBlock, statusText, TABS } from './ui.js'

const PANE = 'pokeidle'
const PANE_COLUMNS = 64
const SAVE_KEY = 'save'
const OWNER_KEY = 'owner'
const OWNER_STALE_MS = 20000
// How often the session refreshes its claim on the save, or checks another's
const OWNER_CHECK_MS = 5000
const SAVE_EVERY_MS = 8000
// Seconds between steps while Claude works, and while idle play is on. A step
// plays one battle turn, so a typical wild battle lasts 10-20 seconds.
const PACE = { slow: 8, normal: 5, fast: 3 }
const IDLE_PACE = 15

// Offline progress when idle play is on: one step per minute away, capped
const OFFLINE_CAP = 240

let state = null
// Only one session plays the save automatically; the others follow it, and any
// session can still manage the team from the pane
let follower = false
let sessionId = ''
let working = false
let toolCallsThisTurn = 0
// The last sign of a running turn; a turn with no news for this long is over
// even if its end never arrived
let lastActivity = 0
const TURN_SILENCE_MS = 10 * 60 * 1000
let dirty = false
let lastSave = 0
let lastStep = 0
let lastOwnerCheck = 0
// Subagents draw spinners of their own; the game shows only under the main one
const subagents = new Set()
let ui = { tab: 'battle', sel: { party: null, pc: null, bag: null, dex: 0 }, page: { pc: 0, dex: 0 }, pcSort: 'recent', confirm: null, msg: null, trainer: '' }

const rng = Math.random

// ---------- persistence ----------

// The session where Claude is working plays the save. Another session that is
// only open, idle, hands it over; when both work, the one that had it keeps it.
async function claimOwner($) {
  const now = await $.clock.now()
  const owner = await $.store.get(OWNER_KEY)
  const live = owner && owner.id !== sessionId && now - owner.at < OWNER_STALE_MS
  if (live && (owner.working || !working)) {
    follower = true
    return false
  }
  if (follower) {
    // Taking over from a session that stopped: start from its latest save
    follower = false
    await loadSave($)
  }
  await $.store.set(OWNER_KEY, { id: sessionId, at: now, working })
  return true
}

async function loadSave($) {
  const saved = await $.store.get(SAVE_KEY)
  state = saved ? G.migrate(saved) : null
}

async function save($) {
  if (!state) return
  state.savedAt = await $.clock.now()
  await $.store.set(SAVE_KEY, state)
  dirty = false
  lastSave = state.savedAt
}

function offlineProgress(state, now) {
  if (!state.settings.idlePlay || !state.savedAt) return
  const minutes = Math.floor((now - state.savedAt) / 60000)
  const steps = Math.min(OFFLINE_CAP, minutes)
  if (steps < 5) return
  const before = { wins: state.stats.wins, caught: state.stats.caught, money: state.money }
  for (let i = 0; i < steps; i++) G.step(state, rng)
  G.log(state, `While you were away: ${state.stats.wins - before.wins} wins, ${state.stats.caught - before.caught} caught, ₽${state.money - before.money}.`, 'good')
}

// ---------- the game loop ----------

function redraw($) {
  $.ui.invalidate('ui.render')
}

function advance($, steps) {
  if (!state || follower) return
  try {
    for (let i = 0; i < steps; i++) G.step(state, rng)
  } catch {
    // A battle the engine can't continue is dropped, so the game goes on
    state.battle = null
  }
  dirty = true
  redraw($)
}

async function tick($) {
  const now = await $.clock.now()
  if (working && now - lastActivity > TURN_SILENCE_MS) working = false
  if (now - lastOwnerCheck >= OWNER_CHECK_MS) {
    lastOwnerCheck = now
    await claimOwner($)
    if (follower) {
      // Another session plays this save: follow its progress
      const saved = await $.store.get(SAVE_KEY)
      if (saved && (!state || saved.savedAt !== state.savedAt)) {
        state = G.migrate(saved)
        redraw($)
      }
    }
  }
  if (follower) return
  if (state) {
    const pace = working ? PACE[state.settings.speed] || PACE.normal : state.settings.idlePlay ? IDLE_PACE : 0
    if (pace && now - lastStep >= pace * 1000) {
      lastStep = now
      advance($, 1)
    }
  }
  if (dirty && now - lastSave >= SAVE_EVERY_MS) {
    // Another session may have taken the save over since the last check
    const owner = await $.store.get(OWNER_KEY)
    if (owner && owner.id !== sessionId) {
      follower = true
      await loadSave($)
      redraw($)
      return
    }
    await save($)
  }
}

// ---------- the pane ----------

async function openPane($) {
  await $.ui.open({ id: PANE, title: 'PokeIdle', focus: true, closeOnEscape: true, columns: PANE_COLUMNS })
}

// ---------- player actions from the pane ----------

const ACTIONS = {
  makeLead: G.makeLead,
  movePartyMon: G.movePartyMon,
  depositMon: G.depositMon,
  withdrawMon: G.withdrawMon,
  swapWithParty: G.swapWithParty,
  releaseMon: G.releaseMon,
  renameMon: G.renameMon,
  toggleEvolution: G.toggleEvolution,
  useItem: G.useItem,
  buy: G.buy,
  sell: G.sell,
  buyGift: (s, i) => G.buyGift(s, i, rng),
  setZone: G.setZone,
  challengeGym: G.challengeGym,
  visitCenter: G.visitCenter,
  setSetting: G.setSetting,
  toggle: G.toggle,
  releaseDuplicates: G.releaseDuplicates,
}

async function act($, name, args) {
  // Another session plays this save: act on its latest state, not a stale copy
  if (follower) await loadSave($)
  if (name === 'newGame') {
    state = G.newGame(rng, args[0], args[1])
    ui = { ...ui, tab: 'battle', msg: null }
  } else if (name === 'resetGame') {
    state = null
    await $.store.delete(SAVE_KEY)
    ui = { ...ui, confirm: null, msg: null }
    redraw($)
    return
  } else if (state && ACTIONS[name]) {
    const err = ACTIONS[name](state, ...args)
    ui = { ...ui, confirm: null, msg: err ? { ok: false, text: err } : null }
  }
  redraw($)
  await save($)
}

function setView($, patch) {
  ui = { ...ui, msg: null, ...patch }
  redraw($)
}

// ---------- hooks ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id()
    await loadSave($)
    await claimOwner($)
    if (state && !follower) {
      offlineProgress(state, await $.clock.now())
      await save($)
    }
    $.clock.every(500, () => tick($))
    await $.command.register({
      name: 'pokeidle',
      description: 'Open PokeIdle: your Pokémon adventure that plays while Claude works',
      argumentHint: '[battle|party|pc|bag|mart|map|dex|options|status]',
      immediate: true,
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await save($)
    const owner = await $.store.get(OWNER_KEY)
    if (owner && owner.id === sessionId) await $.store.delete(OWNER_KEY)
    return next(e)
  })

  // A turn of Claude's work runs the game
  on('turn.start', async ($, e, next) => {
    working = true
    toolCallsThisTurn = 0
    lastOwnerCheck = await $.clock.now()
    lastActivity = lastOwnerCheck
    await claimOwner($)
    redraw($)
    return next(e)
  })

  // Each request to the model shows the turn is still alive
  on('turn.step', async function* ($, e, next) {
    lastActivity = await $.clock.now()
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Subagents finish turns of their own inside the main one
    if (e.agentId) {
      subagents.delete(e.agentId)
      return next(e)
    }
    working = false
    // Refresh the claim (now idle) and learn whether this session still plays
    await claimOwner($)
    if (follower) await loadSave($)
    if (state && e.reason === 'answer') {
      G.turnBonus(state, rng, toolCallsThisTurn)
      dirty = true
    }
    redraw($)
    await save($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started && started.agentId) subagents.add(started.agentId)
    return started
  })

  on('tool.call', async ($, e, next) => {
    if (state) {
      state.stats.toolCalls++
      toolCallsThisTurn++
      lastActivity = await $.clock.now()
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('command.run', { command: 'pokeidle' }, async ($, e) => {
    const arg = (e.args || '').trim().toLowerCase()
    if (arg === 'status') return { text: statusText(state) }
    const surfaces = await $.session.surfaces()
    if (!surfaces.length) return { text: statusText(state) }
    const tab = TABS.find(([id, name]) => id === arg || name.toLowerCase() === arg)
    if (tab) ui = { ...ui, tab: tab[0], confirm: null, msg: null }
    await openPane($)
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    ui = { ...ui, confirm: null, msg: null }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const E = $.ui.resolve(e)
    return paneTree(E, {
      state,
      ui,
      working,
      surface: e.surface,
      placement: e.props.placement,
      cols: e.props.bodyColumns,
      rows: e.props.scroll ? e.props.scroll.bodyRows : 0,
      act: (name, ...args) => act($, name, args),
      view: (patch) => setView($, patch),
    })
  })

  // Claude Code draws the spinner only while Claude works: keep it, and add the
  // game's block under it
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const theirs = await next(e)
    if (subagents.has(e.requestId)) return theirs
    const E = $.ui.resolve(e)
    if (!state) {
      // No game yet: one quiet line so a new player can find it
      const hint = E.Text({ dimColor: true, children: ['  ◓ PokeIdle: run /pokeidle to pick your first Pokémon'] })
      return E.Box({ flexDirection: 'column', children: [theirs, hint] })
    }
    const columns = e.viewport ? e.viewport.columns : 100
    // A broken save must never cost Claude Code its spinner
    let block
    try {
      block = spinnerBlock(E, state, e.surface, columns)
    } catch {
      return theirs
    }
    return E.Box({ flexDirection: 'column', children: [theirs, block] })
  })
}
