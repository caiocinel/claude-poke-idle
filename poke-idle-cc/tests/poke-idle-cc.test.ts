import { expect, mock, test } from 'claude-code/testing'
import * as G from '../hooks/game/engine.js'

// What Claude Code passes to a ui.render hook for the pane, apart from the app
const PANE = {
  plugin: 'poke-idle-cc',
  component: 'Pane',
  requestId: 'pokeidle',
  viewport: { columns: 140, rows: 60 },
  props: {
    title: 'PokeIdle',
    isFocused: true,
    bodyColumns: 110,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 50 },
    view: {},
  },
} as const

// Stubs for everything the mod calls, with a store the test can read
function setup(on, initial: Record<string, unknown> = {}, placed = { dock: true }) {
  const saved = new Map<string, unknown>(Object.entries(initial))
  const toasts: string[] = []
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'test-session' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('command.register', () => ({ value: undefined }))
  const panes: string[] = []
  on('ui.open', ($, e) => {
    panes.push('open' + (e.focus ? ':focus' : ''))
    return { value: placed.dock ? { isPlaced: true } : { isPlaced: false, reason: 'no room for a side pane' } }
  })
  on('ui.close', ($, e) => {
    panes.push('close')
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  const clock = mock.clock(on, { now: 1_000_000 })
  return { saved, toasts, clock, panes }
}

async function start($) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

async function pickStarter($, key = 'starter-25') {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key })
  return ui
}

test('a new player picks a starter and the save is written', async ($, on) => {
  const { saved } = setup(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Welcome to PokeIdle' })).toBeDefined()
  await ui.press({ key: 'starter-4' })
  const save = saved.get('save') as any
  expect(save.party.length).toBe(1)
  expect(save.party[0].s).toBe(4)
  expect(save.caught['4']).toBe(1)
  // The battle tab is shown next
  expect(await ui.find({ type: 'Text', text: /Charmander Lv5/ })).toBeDefined()
  await ui.unmount()
})

test('a turn plays battles calmly and pays a bonus for its tool calls', async ($, on) => {
  const { saved, clock } = setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.unmount()
  const money = (saved.get('save') as any).money
  await $.turn.start({ turnId: 't1', text: 'fix the bug' })
  for (let i = 0; i < 30; i++) await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  // Tool calls don't rush the game: nothing has played yet
  expect((saved.get('save') as any).stats.steps).toBe(0)
  // A minute of work plays about a dozen steps
  await clock.advance(60_000)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer', usage: null })
  const save = saved.get('save') as any
  expect(save.stats.toolCalls).toBe(30)
  expect(save.stats.turns).toBe(1)
  expect(save.stats.battles).toBeDefined()
  expect(save.stats.battles > 0).toBe(true)
  expect(save.money > money).toBe(true)
})

test('the game plays on a timer only while Claude works', async ($, on) => {
  const { saved, clock } = setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.unmount()
  await clock.advance(20_000)
  const idleSteps = (saved.get('save') as any).stats.steps
  expect(idleSteps).toBe(0)
  await $.turn.start({ turnId: 't1', text: 'work' })
  await clock.advance(60_000)
  const steps = (saved.get('save') as any).stats.steps
  expect(steps >= 10 && steps <= 13).toBe(true)
})

test('every tab draws in the terminal and the desktop app', async ($, on) => {
  setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  for (let i = 0; i < 20; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const tab of ['battle', 'party', 'pc', 'bag', 'mart', 'map', 'dex', 'options']) {
      await ui.press({ key: 'tab-' + tab })
      expect(await ui.find({ type: 'Text', text: / badges · Dex / })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the party can be reordered and a Pokémon sent to the PC', async ($, on) => {
  const { saved } = setup(on)
  await start($)
  const ui = await pickStarter($)
  // Buy a gift Pokémon so the party has two
  await ui.press({ key: 'tab-mart' })
  await ui.press({ key: 'buy1-poke-ball' })
  let save = saved.get('save') as any
  expect(save.bag['poke-ball']).toBe(11)
  save.money = 50000
  save.badges = 1
  await ui.unmount()
  // Reload the edited save as a fresh session would
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui2.press({ key: 'tab-mart' })
  await ui2.press({ key: 'gift-0' })
  save = saved.get('save') as any
  expect(save.party.length).toBe(2)
  expect(save.party[1].s).toBe(1)
  await ui2.press({ key: 'tab-party' })
  await ui2.press({ key: 'p-' + save.party[1].u })
  await ui2.press({ key: 'lead' })
  save = saved.get('save') as any
  expect(save.party[0].s).toBe(1)
  await ui2.press({ key: 'deposit' })
  save = saved.get('save') as any
  expect(save.party.length).toBe(1)
  expect(save.pc.length).toBe(1)
  await ui2.press({ key: 'tab-pc' })
  await ui2.press({ key: 'withdraw' })
  save = saved.get('save') as any
  expect(save.party.length).toBe(2)
})

test('releasing a Pokémon asks for confirmation', async ($, on) => {
  const { saved } = setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.press({ key: 'tab-party' })
  await ui.press({ key: 'release' })
  // One Pokémon cannot be released, and nothing happened yet
  expect(await ui.find({ key: 'release' })).toBeDefined()
  await ui.press({ key: 'release' })
  expect((saved.get('save') as any).party.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'You cannot release your last Pokémon.' })).toBeDefined()
})

test('/pokeidle status prints a summary', async ($, on) => {
  setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.unmount()
  const answer = await $.command.run({ command: 'pokeidle', args: 'status' })
  expect(answer.text).toMatch(/Party: Pikachu Lv5/)
})

test('/pokeidle opens the pane on the requested tab', async ($, on) => {
  setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  const answer = await $.command.run({ command: 'pokeidle', args: 'bag' })
  expect(answer).toEqual({})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Bag · / })).toBeDefined()
})

test('a second session can manage the team but does not play it', async ($, on) => {
  const { saved, clock } = setup(on, { owner: { id: 'other-session', at: 1_000_000, working: true } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'starter-1' })
  // The choice is saved even though another session plays
  expect((saved.get('save') as any).party[0].s).toBe(1)
  // The other session keeps its claim, so this one doesn't advance the game
  saved.set('owner', { id: 'other-session', at: 1_000_000 + 20_000, working: true })
  await $.turn.start({ turnId: 't1', text: 'work' })
  await clock.advance(15_000)
  expect((saved.get('save') as any).stats.steps).toBe(0)
})

function lateGame() {
  let seed = 11
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const s = G.newGame(rng, 7, 'Blue')
  s.settings.autoZone = true
  s.settings.autoGym = true
  s.settings.catchMode = 'all'
  for (let i = 0; i < 4000; i++) {
    G.step(s, rng)
    if (s.money > 3000 && (s.bag['poke-ball'] || 0) < 5) G.buy(s, 'poke-ball', 10)
  }
  for (const k of Object.keys(G.ITEMS)) s.bag[k] = 3
  s.party[0].st = 'psn'
  s.party[0].sh = 1
  return JSON.parse(JSON.stringify(s))
}

test('a late-game save draws every tab, wide and narrow', async ($, on) => {
  const late = lateGame()
  const { saved } = setup(on, { save: late })
  await start($)
  for (const [columns, rows] of [[110, 50], [50, 18]]) {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } })
      for (const tab of ['battle', 'party', 'pc', 'bag', 'mart', 'map', 'dex', 'options']) {
        await ui.press({ key: 'tab-' + tab })
        expect(await ui.find({ type: 'Text', text: / badges · Dex / })).toBeDefined()
      }
      await ui.unmount()
    }
  }
  // Use the PC selects: swap a PC Pokémon into the party, then a Full Heal from the bag
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-pc' })
  const before = (saved.get('save') as any) ?? late
  const target = before.party[1].u
  await ui.select({ key: 'swap', value: target })
  const after = saved.get('save') as any
  expect(after.party[1].u === target).toBe(false)
  await ui.press({ key: 'tab-bag' })
  await ui.press({ key: 'bag-full-heal' })
  await ui.select({ key: 'bag-use', value: after.party[0].u })
  expect((saved.get('save') as any).party[0].st).toBe(null)
  // Travel on the map and queue a gym challenge
  await ui.press({ key: 'tab-map' })
  await ui.press({ key: 'zone-route-1' })
  expect((saved.get('save') as any).zone).toBe('route-1')
})

const TURN_END = { turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer', usage: null }

test('Claude working opens no pane', async ($, on) => {
  const { panes } = setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  panes.length = 0
  await $.turn.start({ turnId: 't1', text: 'work' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  await $.turn.complete(TURN_END)
  expect(panes).toEqual([])
})

const SPINNER = {
  plugin: 'poke-idle-cc',
  component: 'Spinner',
  requestId: 'main',
  viewport: { columns: 140, rows: 60 },
  props: { word: 'Working', message: '', suffix: '', mode: 'requesting' },
} as const

test('a block under the spinner shows the battle', async ($, on) => {
  const { clock } = setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  await $.turn.start({ turnId: 't1', text: 'work' })
  await clock.advance(5_000)
  const spin = await $.ui.mount({ ...SPINNER, surface: 'terminal' } as any)
  // Claude Code's spinner is kept, and the game's line follows it
  expect(await spin.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(await spin.find({ type: 'Text', text: /^Pikachu Lv5 +$/ })).toBeDefined()
  expect(await spin.find({ type: 'Text', text: /^wild / })).toBeDefined()
  expect(await spin.find({ key: 'mini-me' })).toBeDefined()
  expect(await spin.find({ key: 'mini-foe' })).toBeDefined()
  // The desktop app has no Raster: the block draws without sprites
  const desk = await $.ui.mount({ ...SPINNER, surface: 'desktop' } as any)
  expect(await desk.find({ type: 'Text', text: /^Pikachu Lv5 +$/ })).toBeDefined()
})

test('the mod draws nothing else', async ($, on) => {
  const { toasts } = setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  await $.turn.start({ turnId: 't1', text: 'work' })
  for (let i = 0; i < 50; i++) await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  const done = await $.turn.complete(TURN_END)
  expect(done.text).toBe('')
  expect(toasts).toEqual([])
  for (const component of ['AbovePrompt', 'PromptHint'] as const) {
    const site = await $.ui.mount({ ...PANE, component, requestId: component, surface: 'terminal', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {}, isDraft: false, hint: '' } as any })
    expect(await site.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
    await site.unmount()
  }
})

test('subagent spinners stay plain', async ($, on) => {
  setup(on)
  on('agent.spawn', () => ({ model: 'claude-test', agentId: 'sub-1' }))
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  await $.turn.start({ turnId: 't1', text: 'work' })
  await $.agent.spawn({ prompt: 'look around', description: 'explore', subagentType: 'Explore' } as any)
  const sub = await $.ui.mount({ ...SPINNER, requestId: 'sub-1', surface: 'terminal' } as any)
  expect(await sub.find({ key: 'mini-me' })).toBeUndefined()
  const main = await $.ui.mount({ ...SPINNER, surface: 'terminal' } as any)
  expect(await main.find({ key: 'mini-me' })).toBeDefined()
})

test('the session where Claude works takes the game over from an idle one', async ($, on) => {
  // Another session holds the save but isn't working
  const { saved, clock } = setup(on, { owner: { id: 'other-session', at: 1_000_000, working: false } })
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  await $.turn.start({ turnId: 't1', text: 'work' })
  expect((saved.get('owner') as any).id).toBe('test-session')
  await clock.advance(15_000)
  expect((saved.get('save') as any).stats.steps > 0).toBe(true)
})

test('a session never takes the game from one where Claude is working', async ($, on) => {
  const { saved, clock } = setup(on, { owner: { id: 'other-session', at: 1_000_000, working: true } })
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  saved.set('owner', { id: 'other-session', at: 1_000_000 + 10_000, working: true })
  await $.turn.start({ turnId: 't1', text: 'work' })
  expect((saved.get('owner') as any).id).toBe('other-session')
})

test('a Rare Candy from the bag levels up the chosen Pokémon', async ($, on) => {
  const { saved } = setup(on)
  await start($)
  const ui = await pickStarter($)
  const save = saved.get('save') as any
  save.bag['rare-candy'] = 2
  await ui.unmount()
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-bag' })
  await pane.press({ key: 'bag-rare-candy' })
  const uid = (saved.get('save') as any).party[0].u
  await pane.select({ key: 'bag-use', value: uid })
  const after = saved.get('save') as any
  expect(after.party[0].lv).toBe(6)
  expect(after.bag['rare-candy']).toBe(1)
})

test('the Mart only lists what the badges allow and buys it', async ($, on) => {
  const { saved } = setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.press({ key: 'tab-mart' })
  expect(await ui.find({ key: 'buy1-ultra-ball' })).toBeUndefined()
  await ui.press({ key: 'buy10-potion' })
  expect((saved.get('save') as any).bag.potion).toBe(15)
  // The Old Rod needs a badge; a new game has none
  expect(await ui.find({ key: 'buy1-old-rod' })).toBeUndefined()
})

test('a damaged save keeps the spinner and the game running', async ($, on) => {
  const late = lateGame()
  late.battle = { kind: 'wild', foes: [], fi: 3, part: [] }
  const { saved, clock } = setup(on, { save: late })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'work' })
  const spin = await $.ui.mount({ ...SPINNER, surface: 'terminal' } as any)
  expect(await spin.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await clock.advance(30_000)
  expect((saved.get('save') as any).stats.steps > late.stats.steps).toBe(true)
})

test('without a game, the spinner shows how to start one', async ($, on) => {
  setup(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'work' })
  const spin = await $.ui.mount({ ...SPINNER, surface: 'terminal' } as any)
  expect(await spin.find({ type: 'Text', text: /run \/pokeidle/ })).toBeDefined()
})

test('a full PC pages, sorts and releases duplicates', async ($, on) => {
  const late = lateGame()
  for (let i = 0; i < 40; i++) late.pc.push({ ...late.pc[0], u: 'dup' + i, lv: 2 })
  const { saved } = setup(on, { save: late })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 62 } })
  await ui.press({ key: 'tab-pc' })
  await ui.press({ key: 'pc-next' })
  expect(await ui.find({ type: 'Text', text: /^Page 2\// })).toBeDefined()
  await ui.select({ key: 'pc-sort', value: 'level' })
  const before = (saved.get('save') as any)?.pc.length ?? late.pc.length
  await ui.press({ key: 'dupes' })
  await ui.press({ key: 'dupes' })
  const after = (saved.get('save') as any).pc.length
  expect(after < before).toBe(true)
})

test('the Pokédex lists what the player has seen, or all 151', async ($, on) => {
  setup(on)
  await start($)
  const ui = await pickStarter($)
  await ui.press({ key: 'tab-dex' })
  expect(await ui.find({ key: 'dex-25' })).toBeDefined()
  expect(await ui.find({ key: 'dex-1' })).toBeUndefined()
  await ui.press({ key: 'dex-all' })
  expect(await ui.find({ key: 'dex-1' })).toBeDefined()
  await ui.press({ key: 'dex-next' })
  expect(await ui.find({ type: 'Text', text: 'Page 2/11' })).toBeDefined()
})

test('a turn whose end never arrives stops playing after a long silence', async ($, on) => {
  const { saved, clock } = setup(on)
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  await $.turn.start({ turnId: 't1', text: 'work' })
  await clock.advance(11 * 60 * 1000)
  const steps = (saved.get('save') as any).stats.steps
  await clock.advance(5 * 60 * 1000)
  expect((saved.get('save') as any).stats.steps).toBe(steps)
})

// A fake PokeIdle server answering $.http.fetch
function fakeServer(on, handlers: Record<string, (body: any, auth?: string) => [number, any]>) {
  const calls: string[] = []
  on('http.fetch', ($, e) => {
    const path = e.url.replace('https://pokeidle.caiocinel.com', '')
    const key = `${(e.init && e.init.method) || 'GET'} ${path}`
    calls.push(key)
    const h = handlers[key]
    const [status, body] = h ? h(e.init && e.init.body ? JSON.parse(e.init.body) : null, e.init && e.init.headers && e.init.headers.authorization) : [404, { error: 'nope' }]
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } }
  })
  return calls
}

test('signing in with GitHub links the machine and syncs the save', async ($, on) => {
  const { saved, clock } = setup(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  let serverSave: any = null
  let polls = 0
  const calls = fakeServer(on, {
    'POST /login/start': () => [200, { id: 'L1', code: 'ABCD-1234', url: 'https://github.com/login/device', interval: 5, expiresIn: 900 }],
    'POST /login/poll': (b) => (++polls < 2 ? [202, { pending: true, interval: 5 }] : [200, { token: 'tok', login: 'ash' }]),
    'GET /save': () => [200, { save: serverSave, savedAt: serverSave ? serverSave.savedAt : null }],
    'PUT /save': (b, auth) => {
      expect(auth).toBe('Bearer tok')
      serverSave = b.save
      expect(b.team.team.length).toBe(1)
      return [200, { ok: true, savedAt: b.save.savedAt }]
    },
  })
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  const sent = await $.command.run({ command: 'pokeidle', args: 'login' })
  expect(sent.text).toMatch(/enter the code ABCD-1234 \(copied/)
  // The timer polls until the player approves on GitHub
  await clock.advance(12_000)
  expect(logs.at(-1)).toMatch(/Signed in as @ash/)
  expect((saved.get('account') as any).token).toBe('tok')
  expect(serverSave.party[0].s).toBe(25)
  expect(calls.filter((c) => c === 'POST /login/poll').length).toBe(2)
})

test('a newer save from another machine replaces this one at start', async ($, on) => {
  const late = lateGame()
  late.savedAt = 2_000_000_000_000
  const { saved } = setup(on, { account: { login: 'ash', token: 'tok' }, save: { ...lateGame(), savedAt: 1 } })
  fakeServer(on, {
    'GET /save': () => [200, { save: late, savedAt: late.savedAt }],
    'GET /inbox': () => [200, { battles: [{ id: 1, challenger: 'gary', won: true, draw: false, prize: 1500, summary: 'Blue wins!' }] }],
    'PUT /save': (b) => [200, { ok: true, savedAt: b.save.savedAt }],
  })
  await start($)
  const status = await $.command.run({ command: 'pokeidle', args: 'status' })
  expect(status.text).toMatch(/Signed in as @ash/)
  expect(status.text).toMatch(new RegExp(`₽${late.money + 1500}`))
})

test('a battle by GitHub username pays a prize and logs the result', async ($, on) => {
  const { saved } = setup(on, { account: { login: 'ash', token: 'tok' } })
  fakeServer(on, {
    'GET /save': () => [200, { save: null, savedAt: null }],
    'GET /inbox': () => [200, { battles: [] }],
    'PUT /save': (b) => [200, { ok: true, savedAt: b.save.savedAt }],
    'POST /battle': (b) => (b.opponent === 'gary'
      ? [200, { you: 'Red', them: 'Gary', opponent: 'gary', won: true, draw: false, prize: 1500, log: ['Red challenges Gary!', 'Red wins with 1 Pokémon standing!'], turns: 3 }]
      : [404, { error: `@${b.opponent} has no PokeIdle team yet.` }]),
  })
  await start($)
  const first = await pickStarter($)
  await first.unmount()
  const money = (saved.get('save') as any).money
  const r = await $.command.run({ command: 'pokeidle', args: 'battle @gary' })
  expect(r.text).toMatch(/You won! \+₽1500/)
  expect((saved.get('save') as any).money).toBe(money + 1500)
  const miss = await $.command.run({ command: 'pokeidle', args: 'battle nobody' })
  expect(miss.text).toBe('@nobody has no PokeIdle team yet.')
})

test('without an account, online commands ask to sign in and nothing goes out', async ($, on) => {
  setup(on)
  const calls = fakeServer(on, {})
  await start($)
  const r = await $.command.run({ command: 'pokeidle', args: 'battle gary' })
  expect(r.text).toMatch(/Sign in with GitHub first/)
  expect(calls).toEqual([])
})
