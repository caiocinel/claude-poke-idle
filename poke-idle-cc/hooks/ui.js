// Element trees for the PokeIdle side pane. Pure: every builder takes the
// elements table `E` and a context with the game state, the view state, and the
// callbacks `act(name, ...args)` and `view(patch)` that register.js supplies.

import * as G from './game/engine.js'
import { pixels, spriteCells, silhouette, tiny } from './game/sprites.js'
import { foundAt, evolutionText } from './game/dex.js'

const { SPECIES, MOVES, ZONES, TYPES, ITEMS, GIFT_SHOP, GYMS } = G

export const TABS = [
  ['battle', 'Battle'], ['party', 'Party'], ['pc', 'PC'], ['bag', 'Bag'],
  ['mart', 'Mart'], ['map', 'Map'], ['dex', 'Pokédex'], ['options', 'Options'],
]

const STATUS = { par: ['PAR'], slp: ['SLP'], frz: ['FRZ'], brn: ['BRN'], psn: ['PSN'] }
const PC_PAGE = 12
const DEX_PAGE = 15

// ---------- small element helpers ----------

function kit(E) {
  // Text takes no key, so drop one passed for readability
  const T = (text, { key, ...props } = {}) => E.Text({ wrap: 'truncate-end', ...props, children: [String(text)] })
  const Row = (children, props = {}) => E.Box({ flexDirection: 'row', columnGap: 1, ...props, children: children.filter(Boolean) })
  const Col = (children, props = {}) => E.Box({ flexDirection: 'column', ...props, children: children.filter(Boolean) })
  const Btn = (key, label, onPress, extra = {}) => E.Button({ key, label, onPress, ...extra })
  const Gap = () => T(' ')
  return { T, Row, Col, Btn, Gap }
}

export function bar(frac, width) {
  const f = Math.max(0, Math.min(1, frac))
  const full = Math.round(f * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const typeLabel = (t) => TYPES[t][0].toUpperCase() + TYPES[t].slice(1)

function typeBadges(k, s) {
  return SPECIES[s].t.map((t) => k.T(typeLabel(t), { dimColor: true }))
}

function statusBadge(k, mon) {
  if (mon.hp === 0) return k.T('FNT', { dimColor: true })
  if (!mon.st) return null
  return k.T(STATUS[mon.st][0], { dimColor: true })
}

function hpLine(k, mon, width = 16) {
  const max = G.maxHp(mon)
  const frac = mon.hp / max
  return k.Row([k.T('HP'), k.T(bar(frac, width), { dimColor: true }), k.T(`${mon.hp}/${max}`), statusBadge(k, mon)])
}

function xpLine(k, mon, width = 16) {
  const g = SPECIES[mon.s].g
  const lo = G.expForLevel(g, mon.lv)
  const hi = G.expForLevel(g, mon.lv + 1)
  const frac = mon.lv >= G.MAX_LEVEL ? 1 : (mon.xp - lo) / Math.max(1, hi - lo)
  return k.Row([k.T('XP'), k.T(bar(frac, width), { dimColor: true }), k.T(mon.lv >= G.MAX_LEVEL ? 'MAX' : `${hi - mon.xp} to Lv${mon.lv + 1}`, { dimColor: true })])
}

const label = (mon) => `${mon.sh ? '★ ' : ''}${G.monName(mon)} Lv${mon.lv}`

// Who the foe belongs to, with its place in a trainer's team: "Brock's Onix Lv14 (2/2)"
function foeLabel(b, foe, wild) {
  if (b.kind === 'wild') return `${wild} ${label(foe)}`
  return `${b.name}'s ${label(foe)}${b.foes.length > 1 ? ` (${b.fi + 1}/${b.foes.length})` : ''}`
}

function sprite(E, key, s, opts = {}) {
  const px = pixels(s, !!opts.back, !!opts.shiny, !!opts.half)
  const p = opts.unknown ? silhouette(px) : px
  const columns = p.w
  const rows = Math.ceil(p.h / 2)
  return E.Raster({ key, columns, rows, cells: spriteCells(p, columns, rows) })
}

// ---------- top bar and tabs ----------

function header(E, k, ctx) {
  const { state } = ctx
  const dex = G.dexCounts(state)
  return k.Col([
    k.Row([
      k.T(`${state.name} · ₽${state.money.toLocaleString('en-US')} · ${Math.min(state.badges, 8)}/8 badges · Dex ${dex.caught}/151`, { dimColor: true }),
    ]),
    k.Row(TABS.map(([id, name], i) => k.Btn(`tab-${id}`, name, () => ctx.view({ tab: id, confirm: null, msg: null }), {
      hotkey: String(i + 1), plain: true, dimColor: ctx.ui.tab !== id,
    })), { columnGap: 2, flexWrap: 'wrap' }),
    ctx.ui.msg ? k.T(ctx.ui.msg.text, { dimColor: true }) : null,
  ])
}

// ---------- Battle ----------

// The log keeps every battle turn; the pane shows only what matters
function logLines(k, state, n) {
  return state.events
    .slice(-n)
    .map((l) => k.T(l.t, { dimColor: l.k !== 'rare' }))
}

function fighter(k, title, mon) {
  const max = G.maxHp(mon)
  return k.Col([
    k.T(title),
    k.Row([k.T(bar(mon.hp / max, 10), { dimColor: true }), k.T(`${mon.hp}/${max}`, { dimColor: true }), mon.st ? k.T(STATUS[mon.st][0], { dimColor: true }) : null]),
  ])
}

function battleTab(E, k, ctx) {
  const { state } = ctx
  const b = state.battle
  const me = b ? G.activeMon(state) : state.party[0]
  const foe = b ? b.foes[b.fi] : null
  const terminal = ctx.surface === 'terminal'
  const where = G.zoneById(state.zone).n
  const status = ctx.working ? where : `${where} · resting until Claude works`
  const foeTitle = foe
    ? `${foeLabel(b, foe, 'Wild')}${state.caught[foe.s] ? '' : ' · new'}`
    : null
  const row = (mon, back, title) => k.Row([
    terminal ? miniSprite(E, (back ? 'me' : 'foe') + '-sprite', mon, back) : null,
    fighter(k, title, mon),
  ], { columnGap: 2, alignItems: 'center' })
  return k.Col([
    k.T(status, { dimColor: true }),
    k.Gap(),
    foe ? row(foe, false, foeTitle) : k.T('Looking for Pokémon...', { dimColor: true }),
    k.Gap(),
    me ? row(me, true, label(me)) : null,
    k.Gap(),
    ...logLines(k, state, 8),
  ])
}

// ---------- shared Pokémon detail ----------

function monDetail(E, k, ctx, mon, where) {
  const st = G.statsOf(mon)
  const terminal = ctx.surface === 'terminal'
  const moves = mon.mv.map((id, i) => {
    const mv = MOVES[id]
    return k.Row([
      k.T(mv.n.padEnd(13), { bold: true }),
      k.T(typeLabel(mv.t).slice(0, 4).padEnd(4), { dimColor: true }),
      k.T(mv.p ? `pow ${String(mv.p).padStart(3)}` : mv.fix ? 'fixed  ' : 'status ', { dimColor: true }),
      k.T(mv.a ? `acc ${mv.a}` : 'acc  —', { dimColor: true }),
    ], { key: 'mv' + i })
  })
  const evo = (SPECIES[mon.s].e || []).map((e) => `${SPECIES[e.to].n} (${e.lvl ? 'Lv' + e.lvl : ITEMS[e.item].n})`).join(', ')
  const zone = mon.z ? (ZONES.find((z) => z.id === mon.z) || {}).n : null
  const info = k.Col([
    k.Row([k.T(label(mon), { bold: true }), ...typeBadges(k, mon.s)]),
    k.T(`#${String(mon.s).padStart(3, '0')} ${SPECIES[mon.s].n}${mon.nk ? ` "${mon.nk}"` : ''}`, { dimColor: true }),
    hpLine(k, mon, 12),
    xpLine(k, mon, 12),
    k.T(`ATK ${st.atk}  DEF ${st.def}  SPC ${st.spc}  SPE ${st.spe}`),
    k.T(`DVs ${mon.dv.join('/')}${zone ? ` · met in ${zone}` : ''}`, { dimColor: true }),
    evo ? k.T(`Evolves: ${evo}${mon.noEvo ? ' (stopped)' : ''}`, { dimColor: true }) : null,
  ])
  return k.Col([
    k.Row([terminal ? sprite(E, `detail-sprite`, mon.s, { shiny: !!mon.sh, half: true }) : null, info], { columnGap: 2 }),
    ...moves,
  ])
}

function confirmBtn(k, ctx, key, text, confirmText, hotkey, run) {
  const armed = ctx.ui.confirm === key
  return k.Btn(key, armed ? confirmText : text, () => {
    if (armed) run()
    else ctx.view({ confirm: key })
  }, { hotkey })
}

function monActions(E, k, ctx, mon, where) {
  const uid = mon.u
  const items = G.usableItems(ctx.state, mon)
  const parts = []
  if (where === 'party') {
    parts.push(k.Row([
      k.Btn('lead', 'l: Lead', () => ctx.act('makeLead', uid), { hotkey: 'l' }),
      k.Btn('up', 'k: Up', () => ctx.act('movePartyMon', uid, -1), { hotkey: 'k' }),
      k.Btn('down', 'j: Down', () => ctx.act('movePartyMon', uid, 1), { hotkey: 'j' }),
      k.Btn('deposit', 'd: To PC', () => ctx.act('depositMon', uid), { hotkey: 'd' }),
    ], { flexWrap: 'wrap' }))
  } else {
    const party = ctx.state.party
    parts.push(k.Row([
      k.Btn('withdraw', 'w: Withdraw', () => ctx.act('withdrawMon', uid), { hotkey: 'w' }),
      party.length ? E.Select({
        key: 'swap',
        label: 'Swap with',
        options: party.map((m) => ({ value: m.u, label: label(m) })),
        onSelect: (v) => ctx.act('swapWithParty', uid, v),
      }) : null,
    ].filter(Boolean), { flexWrap: 'wrap' }))
  }
  parts.push(k.Row([
    (SPECIES[mon.s].e || []).some((e) => e.lvl)
      ? k.Btn('evo', mon.noEvo ? 'e: Allow evolving' : 'e: Stop evolving', () => ctx.act('toggleEvolution', uid), { hotkey: 'e' })
      : null,
    confirmBtn(k, ctx, 'release', 'r: Release', `r: Really release ${G.monName(mon)}?`, 'r', () => ctx.act('releaseMon', uid)),
  ], { flexWrap: 'wrap' }))
  if (items.length) {
    parts.push(E.Select({
      key: 'use-item',
      label: 'Use item',
      options: items.map((it) => ({ value: it, label: `${ITEMS[it].n} ×${ctx.state.bag[it]}` })),
      onSelect: (v) => ctx.act('useItem', v, uid),
    }))
  }
  parts.push(E.Input({
    key: 'rename',
    label: 'Nickname',
    placeholder: G.monName(mon),
    value: '',
    submitLabel: 'rename',
    onSubmit: (v) => ctx.act('renameMon', uid, v),
  }))
  return k.Col(parts)
}

function split(k, ctx, left, right) {
  if (ctx.cols >= 96) return k.Row([k.Col(left, { width: 40 }), k.Col(right, { flexGrow: 1 })], { columnGap: 3 })
  return k.Col([...left, k.Gap(), ...right])
}

// ---------- Party ----------

function partyTab(E, k, ctx) {
  const { state } = ctx
  const sel = state.party.find((m) => m.u === ctx.ui.sel.party) || state.party[0]
  const rows = state.party.map((m, i) => {
    const frac = m.hp / G.maxHp(m)
    return k.Row([
      k.Btn('p-' + m.u, `${i + 1}. ${label(m)}`.padEnd(22), () => ctx.view({ sel: { ...ctx.ui.sel, party: m.u }, confirm: null }), {
        plain: true, dimColor: sel && sel.u !== m.u,
      }),
      k.T(`${bar(frac, 6)} ${String(m.hp).padStart(3)}/${G.maxHp(m)}`, { dimColor: true }),
      statusBadge(k, m),
    ], { key: 'pr-' + m.u })
  })
  const left = [
    k.T(`Party ${state.party.length}/${G.MAX_PARTY} · first one leads`, { dimColor: true }),
    ...rows,
  ]
  const right = sel ? [monDetail(E, k, ctx, sel, 'party'), k.Gap(), monActions(E, k, ctx, sel, 'party')] : []
  return split(k, ctx, left, right)
}

// ---------- PC ----------

const SORTS = {
  recent: (a, b) => (b.ca || 0) - (a.ca || 0),
  level: (a, b) => b.lv - a.lv,
  dex: (a, b) => a.s - b.s || b.lv - a.lv,
  name: (a, b) => G.monName(a).localeCompare(G.monName(b)),
}

export function sortedPc(state, sort) {
  return [...state.pc].sort(SORTS[sort] || SORTS.recent)
}

function pcTab(E, k, ctx) {
  const { state, ui } = ctx
  const list = sortedPc(state, ui.pcSort)
  const pages = Math.max(1, Math.ceil(list.length / PC_PAGE))
  const page = Math.min(ui.page.pc, pages - 1)
  const shown = list.slice(page * PC_PAGE, (page + 1) * PC_PAGE)
  const sel = state.pc.find((m) => m.u === ui.sel.pc) || shown[0]
  const left = [
    k.Row([
      k.T(`PC Box: ${state.pc.length} Pokémon`, { bold: true }),
      E.Select({
        key: 'pc-sort',
        label: 'Sort',
        value: ui.pcSort,
        options: [{ value: 'recent', label: 'Recent' }, { value: 'level', label: 'Level' }, { value: 'dex', label: 'Dex #' }, { value: 'name', label: 'Name' }],
        onSelect: (v) => ctx.view({ pcSort: v, page: { ...ui.page, pc: 0 } }),
      }),
    ]),
    ...shown.map((m) => k.Btn('pc-' + m.u, `#${String(m.s).padStart(3, '0')} ${label(m)}`, () => ctx.view({ sel: { ...ui.sel, pc: m.u }, confirm: null }), {
      plain: true, dimColor: sel && sel.u !== m.u,
    })),
    !list.length ? k.T('The PC is empty. Pokémon caught with a full party land here.', { dimColor: true }) : null,
    k.Row([
      k.Btn('pc-prev', 'p: Prev', () => ctx.view({ page: { ...ui.page, pc: Math.max(0, page - 1) } }), { hotkey: 'p' }),
      k.T(`Page ${page + 1}/${pages}`),
      k.Btn('pc-next', 'n: Next', () => ctx.view({ page: { ...ui.page, pc: Math.min(pages - 1, page + 1) } }), { hotkey: 'n' }),
    ]),
    !list.length ? null : confirmBtn(k, ctx, 'dupes', 'x: Release duplicates', 'x: Release every duplicate below the best of its species?', 'x', () => ctx.act('releaseDuplicates')),
  ]
  const right = sel ? [monDetail(E, k, ctx, sel, 'pc'), k.Gap(), monActions(E, k, ctx, sel, 'pc')] : []
  return split(k, ctx, left, right)
}

// ---------- Bag ----------

function bagTab(E, k, ctx) {
  const { state, ui } = ctx
  const keys = Object.keys(state.bag).filter((it) => state.bag[it] > 0 && ITEMS[it])
  const order = ['ball', 'heal', 'status', 'revive', 'candy', 'evo', 'rod', 'key']
  keys.sort((a, b) => order.indexOf(ITEMS[a].kind) - order.indexOf(ITEMS[b].kind))
  const sel = keys.includes(ui.sel.bag) ? ui.sel.bag : keys[0]
  const left = [
    k.T(`Bag · ₽${state.money.toLocaleString('en-US')}`, { bold: true }),
    ...keys.map((it) => k.Btn('bag-' + it, `${ITEMS[it].n.padEnd(14)} ×${state.bag[it]}`, () => ctx.view({ sel: { ...ui.sel, bag: it } }), {
      plain: true, dimColor: sel !== it,
    })),
    !keys.length ? k.T('The bag is empty. Buy items at the Mart.', { dimColor: true }) : null,
  ]
  const right = []
  if (sel) {
    const it = ITEMS[sel]
    right.push(k.T(it.n, { bold: true }), k.T(it.d, { wrap: 'wrap' }))
    const auto = { ball: 'Thrown automatically when the team decides to catch (see Options).', heal: 'Used automatically when the active Pokémon drops below 25% HP (if auto-potion is on).', rod: 'Used automatically: fishing is now possible where there is water.', key: 'Works automatically while it is in the bag.' }[it.kind]
    if (auto) right.push(k.T(auto, { dimColor: true, wrap: 'wrap' }))
    {
      const targets = [...state.party, ...state.pc].filter((m) => G.canUse(state, sel, m) === null)
      if (['heal', 'status', 'revive', 'candy', 'evo'].includes(it.kind)) {
        right.push(targets.length
          ? E.Select({
            key: 'bag-use',
            label: 'Use on',
            options: targets.slice(0, 60).map((m) => ({ value: m.u, label: `${label(m)}${state.party.includes(m) ? '' : ' (PC)'}` })),
            onSelect: (v) => ctx.act('useItem', sel, v),
          })
          : k.T('No Pokémon can use it right now.', { dimColor: true }))
      }
      if (it.price && !['rod', 'key'].includes(it.kind) && sel !== 'master-ball') {
        right.push(k.Btn('sell', `s: Sell one for ₽${Math.floor(it.price / 2)}`, () => ctx.act('sell', sel), { hotkey: 's' }))
      }
    }
  }
  return split(k, ctx, left, right)
}

// ---------- Mart ----------

function martTab(E, k, ctx) {
  const { state } = ctx
  const items = Object.keys(ITEMS).filter((it) => ITEMS[it].price)
  const open = items.filter((it) => ITEMS[it].badge <= state.badges)
  const nextItems = items.filter((it) => ITEMS[it].badge === state.badges + 1).map((it) => ITEMS[it].n)
  const lockedItems = items.length - open.length
  const rows = open.map((it) => {
    const x = ITEMS[it]
    const owned = x.once && state.bag[it]
    return k.Col([
      k.Row([
        k.T(x.n.padEnd(14), { bold: true }),
        k.T(`₽${x.price}`.padEnd(7)),
        owned ? k.T('owned', { dimColor: true }) : k.Btn('buy1-' + it, x.once ? 'Buy' : 'Buy 1', () => ctx.act('buy', it, 1)),
        !owned && !x.once ? k.Btn('buy10-' + it, 'Buy 10', () => ctx.act('buy', it, 10)) : null,
        state.bag[it] && !x.once ? k.T(`have ${state.bag[it]}`, { dimColor: true }) : null,
      ]),
      k.T('  ' + x.d, { dimColor: true }),
    ], { key: 'mart-' + it })
  })
  const gifts = GIFT_SHOP.map((g, i) => [g, i]).filter(([g]) => g.badge <= state.badges)
  const lockedGifts = GIFT_SHOP.length - gifts.length
  const giftRows = gifts.map(([g, i]) => k.Row([
    k.T(SPECIES[g.s].n.padEnd(11), { bold: true }),
    k.T(`Lv${g.lv}`.padEnd(5), { dimColor: true }),
    k.T(`₽${g.price}`.padEnd(7)),
    state.caught[g.s] ? k.T('caught', { dimColor: true }) : k.Btn('gift-' + i, 'Get', () => ctx.act('buyGift', i)),
    k.T(g.from, { dimColor: true }),
  ], { key: 'giftrow-' + i }))
  return k.Col([
    k.T(`Poké Mart · you have ₽${state.money.toLocaleString('en-US')}`, { bold: true }),
    ...rows,
    nextItems.length ? k.T(`Next badge adds: ${nextItems.join(', ')}`, { dimColor: true, wrap: 'wrap' }) : null,
    lockedItems ? k.T(`${lockedItems} more items unlock with badges`, { dimColor: true }) : null,
    k.Gap(),
    k.T('Special Pokémon', { bold: true }),
    ...giftRows,
    lockedGifts ? k.T(`${lockedGifts} more unlock with badges`, { dimColor: true }) : null,
  ])
}

// ---------- Map ----------

function mapTab(E, k, ctx) {
  const { state } = ctx
  const badges = GYMS.slice(0, 8).map((g, i) => k.T(i < state.badges ? '●' : '○', { key: 'b' + i, dimColor: i >= state.badges }))
  const next = state.badges < GYMS.length ? GYMS[state.badges] : null
  const top = Math.max(...state.party.map((m) => m.lv))
  const open = ZONES.filter((z) => z.badges <= state.badges)
  const locked = ZONES.filter((z) => z.badges > state.badges)
  const zones = open.map((z) => {
    const here = z.id === state.zone
    const species = new Set()
    for (const m of ['walk', 'surf', 'old-rod', 'good-rod', 'super-rod']) for (const e of z[m] || []) species.add(e[0])
    let caught = 0
    for (const sp of species) if (state.caught[sp]) caught++
    const rare = z.static && !state.caught[z.static[0]] ? ' · rare Pokémon' : ''
    return k.Row([
      k.Btn('zone-' + z.id, `${here ? '▶' : ' '} ${z.n}`.padEnd(20), () => ctx.act('setZone', z.id), { plain: true, dimColor: !here }),
      k.T(`Lv${z.lv[0]}-${z.lv[1]}`.padEnd(9), { dimColor: true }),
      k.T(`${caught}/${species.size} caught${rare}`, { dimColor: true }),
      z.lv[0] > top + 3 ? k.T('tough', { dimColor: true }) : null,
    ], { key: 'zr-' + z.id })
  })
  const soon = locked.filter((z) => z.badges === state.badges + 1).map((z) => z.n)
  return k.Col([
    k.Row([k.T('Badges'), ...badges, state.badges > 8 ? k.T('Champion') : null]),
    next
      ? k.T(`Next: ${next.trainers.map((t) => t[0]).join(', ')} in ${next.city}, ace Lv${Math.max(...next.trainers.at(-1)[2].map((t) => t[1]))}`, { wrap: 'wrap' })
      : k.T('You beat the Pokémon League! Keep completing the Pokédex.'),
    next ? k.Btn('map-gym', state.pendingGym ? 'Challenge queued' : 'g: Challenge now', () => ctx.act('challengeGym'), { hotkey: 'g' }) : null,
    k.Gap(),
    ...zones,
    soon.length ? k.T(`  Next badge opens: ${soon.join(', ')}`, { dimColor: true, wrap: 'wrap' }) : null,
    locked.length ? k.T(`  ${locked.length} more zones locked`, { dimColor: true }) : null,
    k.Gap(),
    k.T(`Auto travel ${state.settings.autoZone ? 'on' : 'off'} · auto gyms ${state.settings.autoGym ? 'on' : 'off'} (Options)`, { dimColor: true }),
  ])
}

// ---------- Pokédex ----------

function dexTab(E, k, ctx) {
  const { state, ui } = ctx
  // By default the list holds only what the player has met; 'a' shows all 151
  const all = !!ui.dexAll
  const ids = []
  for (let s = 1; s <= 151; s++) if (all || state.seen[s]) ids.push(s)
  if (!ids.length) ids.push(1)
  const sel = ids.includes(ui.sel.dex) ? ui.sel.dex : ids[0]
  const pages = Math.max(1, Math.ceil(ids.length / DEX_PAGE))
  const page = Math.floor(ids.indexOf(sel) / DEX_PAGE)
  const counts = G.dexCounts(state)
  const goPage = (p) => ctx.view({ sel: { ...ui.sel, dex: ids[p * DEX_PAGE] } })
  const list = ids.slice(page * DEX_PAGE, (page + 1) * DEX_PAGE).map((s) => {
    const mark = state.caught[s] ? '◓' : state.seen[s] ? '◌' : ' '
    return k.Btn('dex-' + s, `${mark} #${String(s).padStart(3, '0')} ${state.seen[s] ? SPECIES[s].n : '?????'}`, () => ctx.view({ sel: { ...ui.sel, dex: s } }), {
      plain: true, dimColor: sel !== s,
    })
  })
  const left = [
    k.T(`Pokédex · seen ${counts.seen} · caught ${counts.caught}/151`, { bold: true }),
    ...list,
    k.Row([
      pages > 1 ? k.Btn('dex-prev', 'p: Prev', () => goPage(Math.max(0, page - 1)), { hotkey: 'p' }) : null,
      pages > 1 ? k.T(`Page ${page + 1}/${pages}`) : null,
      pages > 1 ? k.Btn('dex-next', 'n: Next', () => goPage(Math.min(pages - 1, page + 1)), { hotkey: 'n' }) : null,
      k.Btn('dex-all', all ? 'a: Only seen' : 'a: Show all 151', () => ctx.view({ dexAll: !all }), { hotkey: 'a' }),
    ]),
  ]
  const seen = !!state.seen[sel]
  const sp = SPECIES[sel]
  const statNames = ['HP', 'ATK', 'DEF', 'SPC', 'SPE']
  const right = [
    k.Row([
      ctx.surface === 'terminal' ? sprite(E, 'dex-sprite', sel, { unknown: !seen, half: true }) : null,
      k.Col([
        k.T(`#${String(sel).padStart(3, '0')} ${seen ? sp.n : '?????'}`, { bold: true }),
        seen ? k.Row(typeBadges(k, sel)) : k.T('Not seen yet', { dimColor: true }),
        k.T(state.caught[sel] ? '◓ Caught' : seen ? '◌ Seen' : '', { dimColor: true }),
        sp.leg ? k.T('Legendary', { dimColor: true }) : null,
      ]),
    ], { columnGap: 2 }),
    ...(seen
      ? [
        ...sp.b.map((v, i) => k.Row([k.T(statNames[i].padEnd(3)), k.T(bar(v / 160, 16), { dimColor: true }), k.T(String(v))], { key: 'bs' + i })),
        k.T(`Catch rate ${sp.c} · ${evolutionText(sel)}`, { dimColor: true, wrap: 'wrap' }),
        k.T('Found at:', { bold: true }),
        ...foundAt(sel).slice(0, 8).map((w, i) => k.T('  ' + w, { key: 'fa' + i, dimColor: true })),
      ]
      : [k.T('Battle more to see this Pokémon.', { dimColor: true })]),
  ]
  return split(k, ctx, left, right)
}

// ---------- Options ----------

function optionsTab(E, k, ctx) {
  const { state } = ctx
  const s = state.settings
  const st = state.stats
  const sel = (key, labelText, value, options) => E.Select({
    key: 'opt-' + key, label: labelText, value, options, onSelect: (v) => ctx.act('setSetting', key, v),
  })
  const tog = (key, text, hotkey) => k.Btn('tog-' + key, `${text}: ${s[key] ? 'ON' : 'OFF'}`, () => ctx.act('toggle', key), { hotkey, plain: true })
  const group = (title, rows) => k.Col([k.T(title, { dimColor: true }), k.Col(rows, { paddingLeft: 2 })])
  return k.Col([
    k.T('Options', { bold: true }),
    group('Battle', [
      sel('catchMode', 'Catch', s.catchMode, [{ value: 'new', label: 'New species only' }, { value: 'all', label: 'Everything' }, { value: 'none', label: 'Nothing (shinies only)' }]),
      sel('ball', 'Ball', s.ball, [{ value: 'auto', label: 'Automatic' }, { value: 'poke-ball', label: 'Poké Ball' }, { value: 'great-ball', label: 'Great Ball' }, { value: 'ultra-ball', label: 'Ultra Ball' }]),
      sel('speed', 'Speed', s.speed, [{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]),
      tog('autoPotion', 'Use potions in danger', 'q'),
      tog('autoCenter', 'Heal at the Pokémon Center', 'w'),
    ]),
    group('Team', [
      tog('autoParty', 'Swap in stronger PC Pokémon', 'p'),
      tog('autoStones', 'Use evolution stones', 'e'),
      tog('autoBuy', 'Shop: balls, rods, stones, special Pokémon', 'b'),
    ]),
    group('Progress', [
      tog('autoZone', 'Travel to the best zone', 'z'),
      tog('autoGym', 'Challenge gyms when ready', 'a'),
      tog('idlePlay', 'Keep playing while Claude is idle', 'i'),
    ]),
    k.Gap(),
    k.T('Statistics', { bold: true }),
    k.T(`Battles ${st.battles} · Wins ${st.wins} · Losses ${st.losses} · Caught ${st.caught} · Shinies ${st.shinies} · Evolved ${st.evolved}`),
    k.T(`Claude tasks ${st.turns} · Tool calls ${st.toolCalls} · Steps ${st.steps} · Money earned ₽${st.money.toLocaleString('en-US')}`, { dimColor: true }),
    k.Gap(),
    confirmBtn(k, ctx, 'reset', 'x: New game', 'x: Erase this save and start over?', 'x', () => ctx.act('resetGame')),
  ])
}

// ---------- starter screen ----------

export const STARTERS = [1, 4, 7, 25]

function starterScreen(E, k, ctx) {
  const terminal = ctx.surface === 'terminal'
  return k.Col([
    k.T('Welcome to PokeIdle', { bold: true }),
    k.T('Your team explores Kanto while Claude works.', { dimColor: true, wrap: 'wrap' }),
    k.Gap(),
    E.Input({ key: 'trainer-name', label: 'Trainer name', placeholder: ctx.ui.trainer || 'Red', value: '', submitLabel: 'set', onSubmit: (v) => ctx.view({ trainer: String(v).trim().slice(0, 12) || 'Red' }) }),
    k.T('Choose your first partner:'),
    k.Row(STARTERS.map((s, i) => k.Col([
      terminal ? sprite(E, 'starter-sprite-' + s, s, { half: true }) : null,
      k.Btn('starter-' + s, SPECIES[s].n, () => ctx.act('newGame', s, ctx.ui.trainer || 'Red'), { hotkey: String(i + 1), plain: true }),
    ], { alignItems: 'center', justifyContent: 'flex-end', key: 'st' + s })), { columnGap: 3, flexWrap: 'wrap', alignItems: 'flex-end' }),
  ])
}

// ---------- the pane ----------

export function paneTree(E, ctx) {
  const k = kit(E)
  if (!ctx.state) return starterScreen(E, k, ctx)
  const body = {
    battle: battleTab, party: partyTab, pc: pcTab, bag: bagTab, mart: martTab, map: mapTab, dex: dexTab, options: optionsTab,
  }[ctx.ui.tab] || battleTab
  return k.Col([header(E, k, ctx), k.Gap(), body(E, k, ctx)])
}

// ---------- the block under the spinner ----------

const ROWS_UNDER_SPINNER = 5

function hpText(E, mon, width) {
  const max = G.maxHp(mon)
  const frac = mon.hp / max
  const color = frac > 0.5 ? 'success' : frac > 0.2 ? 'warning' : 'error'
  return [
    E.Text({ color, children: [bar(frac, width)] }),
    E.Text({ dimColor: true, children: [` ${String(mon.hp).padStart(3)}/${max}${mon.st ? ' ' + STATUS[mon.st][0] : ''}`] }),
  ]
}

function miniSprite(E, key, mon, back) {
  const p = tiny(mon.s, back, !!mon.sh, ROWS_UNDER_SPINNER * 2)
  const rows = ROWS_UNDER_SPINNER
  return E.Raster({ key, columns: p.w, rows, cells: spriteCells(p, p.w, rows) })
}

// Five rows while Claude works: both Pokémon as tiny sprites at the edges, and
// between them where the team is, both HP bars, the last two battle lines and
// the party
export function spinnerBlock(E, state, surface, columns) {
  const b = state.battle
  const me = b ? G.activeMon(state) : state.party[0]
  const foe = b ? b.foes[b.fi] : null
  const dex = G.dexCounts(state)
  const T = (text, props = {}) => E.Text({ wrap: 'truncate-end', ...props, children: [text] })
  const Row = (children) => E.Box({ flexDirection: 'row', children: children.filter(Boolean) })
  const sprites = surface === 'terminal' && columns >= 70
  const bw = columns >= 100 ? 12 : 8

  const head = Row([
    T(G.zoneById(state.zone).n, { bold: true }),
    T(`  ₽${state.money.toLocaleString('en-US')} · ${Math.min(8, state.badges)}/8 badges · Dex ${dex.caught}/151`, { dimColor: true }),
  ])
  // One row per Pokémon, names padded so both HP bars line up
  const meName = me ? label(me) : ''
  const foeName = foe ? foeLabel(b, foe, 'wild') : ''
  // Names are cut to fit, so the bars always share a column and nothing wraps
  const NAME = 26
  const fit = (n) => (n.length > NAME ? n.slice(0, NAME - 1) + '…' : n)
  const pad = Math.min(NAME, Math.max(meName.length, foeName.length)) + 1
  const fighterRow = (name, mon, extra) => E.Box({
    flexDirection: 'row',
    flexWrap: 'nowrap',
    children: [T(fit(name).padEnd(pad), { bold: true }), ...hpText(E, mon, bw), extra ? T(extra, { dimColor: true }) : null].filter(Boolean),
  })
  const meRow = me ? fighterRow(meName, me) : T(' ')
  const foeRow = foe ? fighterRow(foeName, foe, state.caught[foe.s] ? '' : '  new!') : T('looking for Pokémon…', { dimColor: true })
  const last = state.log.at(-1)
  const feed = T(last ? '› ' + last.t.replace(/^(Wild|Foe) /, '') : ' ', { dimColor: !last || last.k === 'detail' })
  // The next goal gives the idle progress a direction
  const ready = state.party.slice().sort((x, y) => y.lv - x.lv).slice(0, 3)
  const teamLv = Math.round(ready.reduce((a, m) => a + m.lv, 0) / Math.max(1, ready.length))
  const gym = state.badges < GYMS.length ? GYMS[state.badges] : null
  const goal = gym
    ? `next: ${gym.trainers.at(-1)[0]} Lv${Math.max(...gym.trainers.at(-1)[2].map((t) => t[1]))} · team Lv${teamLv}`
    : `Champion · Dex ${dex.caught}/151`
  const party = Row([
    ...state.party.map((m, i) => E.Text({ key: 'pd' + i, color: m.hp === 0 ? 'error' : m.st ? 'warning' : 'success', children: [m.hp === 0 ? '✕ ' : '● '] })),
    T(' ' + goal, { dimColor: true }),
  ])
  // A fixed width keeps the foe beside the text instead of at the far edge
  const width = Math.min(62, columns - 34)
  const text = E.Box({ flexDirection: 'column', width, children: [head, meRow, foeRow, feed, party] })
  return E.Box({
    flexDirection: 'row',
    columnGap: 2,
    paddingLeft: 2,
    children: [
      sprites && me ? miniSprite(E, 'mini-me', me, true) : null,
      text,
      sprites && foe ? miniSprite(E, 'mini-foe', foe, false) : null,
    ].filter(Boolean),
  })
}

// ---------- plain-text status for /pokeidle status and -p runs ----------

export function statusText(state) {
  if (!state) return 'PokeIdle: no save yet. Run /pokeidle in an interactive session to choose your starter.'
  const dex = G.dexCounts(state)
  const lines = [
    `PokeIdle — ${state.name}: ₽${state.money}, ${Math.min(8, state.badges)} badge(s)${state.badges > 8 ? ', Champion' : ''}, Pokédex ${dex.caught}/151 caught (${dex.seen} seen), in ${G.zoneById(state.zone).n}.`,
    'Party: ' + state.party.map((m) => `${label(m)} (${m.hp}/${G.maxHp(m)} HP)`).join(', '),
    `PC: ${state.pc.length} Pokémon. Bag: ` + Object.entries(state.bag).map(([k, v]) => `${ITEMS[k] ? ITEMS[k].n : k} ×${v}`).join(', '),
  ]
  return lines.join('\n')
}
