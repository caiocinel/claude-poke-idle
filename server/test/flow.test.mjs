// End-to-end test of the server against a fake GitHub:
//   node server/test/flow.test.mjs   (from the repository root)
// It starts the server on a scratch database, signs two players in, syncs their
// saves and has them battle.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startFakeGithub } from './fake-github.mjs'
import * as G from '../../poke-idle-cc/hooks/game/engine.js'

const GH = 18500
const PORT = 18092
const B = `http://127.0.0.1:${PORT}`
const github = await startFakeGithub(GH)
const dir = mkdtempSync(join(tmpdir(), 'pokeidle-'))
// The server imports the engine from ./engine in the Docker image; here, the plugin's copy
const server = spawn(process.execPath, ['server/server.js'], {
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    DB_PATH: join(dir, 'test.db'),
    PORT: String(PORT),
    GITHUB_CLIENT_ID: 'test',
    GITHUB_WEB: `http://127.0.0.1:${GH}`,
    GITHUB_API: `http://127.0.0.1:${GH}`,
    ENGINE: new URL('../../poke-idle-cc/hooks/game/engine.js', import.meta.url).href,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => server.stdout.once('data', resolve))

const call = async (method, path, body, token) => {
  const res = await fetch(B + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return [res.status, await res.json()]
}

async function signIn() {
  const [, s] = await call('POST', '/login/start')
  assert.match(s.code, /^CODE-/)
  const [pending] = await call('POST', '/login/poll', { id: s.id })
  assert.equal(pending, 202)
  const [ok, r] = await call('POST', '/login/poll', { id: s.id })
  assert.equal(ok, 200)
  // A finished sign-in can't be polled again
  assert.equal((await call('POST', '/login/poll', { id: s.id }))[0], 410)
  return r
}

try {
  const ash = await signIn()
  const gary = await signIn()
  assert.equal(ash.login, 'Ash')
  assert.equal(gary.login, 'gary')

  const rng = G.seededRng(5)
  const a = G.newGame(rng, 4, 'Ash')
  a.party = [6, 65, 112].map((s) => G.makeMon(rng, s, 50))
  a.savedAt = Date.now()
  const b = G.newGame(rng, 7, 'Gary')
  b.party = [9, 103, 59].map((s) => G.makeMon(rng, s, 55))
  b.savedAt = Date.now()
  assert.equal((await call('PUT', '/save', { save: a, team: G.teamSnapshot(a) }, ash.token))[0], 200)
  assert.equal((await call('PUT', '/save', { save: b, team: G.teamSnapshot(b) }, gary.token))[0], 200)
  // An older save gets the newer one back
  const [, stale] = await call('PUT', '/save', { save: { ...a, savedAt: 1 } }, ash.token)
  assert.equal(stale.savedAt, a.savedAt)

  // Usernames are case-insensitive, with or without @
  const [st, fight] = await call('POST', '/battle', { opponent: '@GARY' }, ash.token)
  assert.equal(st, 200)
  assert.equal(fight.opponent, 'gary')
  assert.ok(fight.log.length > 3)
  assert.equal((await call('POST', '/battle', { opponent: 'gary' }, ash.token))[0], 429)
  assert.equal((await call('POST', '/battle', { opponent: 'ash' }, ash.token))[1].error, 'You cannot battle yourself.')
  assert.equal((await call('POST', '/battle', { opponent: 'a b@c' }, ash.token))[0], 400)
  assert.equal((await call('POST', '/battle', { opponent: 'nobody' }, ash.token))[0], 404)

  const [, rank] = await call('GET', '/ranking', null, gary.token)
  assert.equal(rank.top.length, 2)
  assert.equal(rank.me.login, 'gary')
  const [, inbox] = await call('GET', '/inbox', null, gary.token)
  assert.equal(inbox.battles.length, 1)
  assert.equal(inbox.battles[0].challenger, 'Ash')
  assert.equal((await call('GET', '/inbox', null, gary.token))[1].battles.length, 0)

  assert.equal((await call('POST', '/logout', null, ash.token))[0], 200)
  assert.equal((await call('GET', '/save', null, ash.token))[0], 401)
  console.log('server flow: ok')
} finally {
  server.kill()
  github.close()
}
