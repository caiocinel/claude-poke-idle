// PokeIdle server: GitHub sign-in, save sync between machines, and battles
// between players. Node's built-in http and sqlite, no dependencies. The battle
// engine is the plugin's own, so a battle here plays exactly as in the game.
//
// Sign-in uses GitHub's device flow: the player opens github.com/login/device
// and types a code. The server asks GitHub who signed in, keeps the account's
// id and login, and forgets GitHub's token at once: it needs no access.

import http from 'node:http'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
// The plugin's engine: copied to ./engine in the Docker image, or the repository's
// own copy when ENGINE points at it (the tests do)
const { cleanSnapshot, pvpBattle, seededRng } = await import(process.env.ENGINE || './engine/engine.js')

const PORT = Number(process.env.PORT || 8090)
const DB_PATH = process.env.DB_PATH || './data/pokeidle.db'
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
// Overridable for tests against a fake GitHub
const GITHUB_WEB = process.env.GITHUB_WEB || 'https://github.com'
const GITHUB_API = process.env.GITHUB_API || 'https://api.github.com'
const MAX_SAVE_BYTES = 512 * 1024
// One battle against the same opponent per this long, so a team can't be farmed
const REMATCH_MS = 10 * 60 * 1000
const WIN_PRIZE = 1500
const LOSS_PRIZE = 300

const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    github_id INTEGER PRIMARY KEY,
    login TEXT NOT NULL,
    created INTEGER NOT NULL,
    save TEXT,
    saved_at INTEGER,
    team TEXT,
    team_at INTEGER,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000
  );
  CREATE UNIQUE INDEX IF NOT EXISTS players_by_login ON players (login COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS logins (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL,
    expires INTEGER NOT NULL,
    interval INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    github_id INTEGER NOT NULL,
    created INTEGER NOT NULL,
    label TEXT
  );
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    challenger INTEGER NOT NULL,
    opponent INTEGER NOT NULL,
    winner INTEGER,
    seed INTEGER NOT NULL,
    result TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS battles_by_challenger ON battles (challenger, at);
  CREATE INDEX IF NOT EXISTS battles_by_opponent ON battles (opponent, at);
`)

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const now = () => Date.now()
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i

// ---------- http helpers ----------

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > MAX_SAVE_BYTES + 4096) throw Object.assign(new Error('Request too large.'), { status: 413 })
    chunks.push(c)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 })
  }
}

function playerFor(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '')
  if (!m) return null
  const row = db.prepare('SELECT github_id FROM tokens WHERE token_hash = ?').get(sha(m[1]))
  return row ? row.github_id : null
}

const loginOf = (id) => db.prepare('SELECT login FROM players WHERE github_id = ?').get(id)?.login

// A small in-memory limit per IP, against abuse of the sign-in endpoints
const hits = new Map()
function limited(key, max, windowMs) {
  const t = now()
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs)
  list.push(t)
  hits.set(key, list)
  return list.length > max
}

async function github(path, init = {}) {
  const res = await fetch(GITHUB_WEB + path, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'pokeidle-server', ...(init.headers || {}) },
  })
  return res.json()
}

// ---------- sign-in with GitHub ----------

async function loginStart(req, res) {
  if (!GITHUB_CLIENT_ID) return reply(res, 503, { error: 'GitHub sign-in is not set up on the server yet.' })
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress
  if (limited('ip:' + ip, 20, 3600_000)) return reply(res, 429, { error: 'Too many sign-ins. Try again later.' })
  const r = await github('/login/device/code', { method: 'POST', body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: '' }) })
  if (!r.device_code) return reply(res, 502, { error: 'GitHub did not start the sign-in: ' + (r.error_description || r.error || 'unknown error') })
  // The client polls with this id; GitHub's device code never leaves the server
  const id = crypto.randomBytes(18).toString('base64url')
  db.prepare('INSERT INTO logins (id, device_code, expires, interval) VALUES (?, ?, ?, ?)')
    .run(id, r.device_code, now() + r.expires_in * 1000, r.interval || 5)
  db.prepare('DELETE FROM logins WHERE expires < ?').run(now())
  reply(res, 200, { id, code: r.user_code, url: r.verification_uri, interval: r.interval || 5, expiresIn: r.expires_in })
}

async function loginPoll(req, res) {
  const { id, label } = await readJson(req)
  const row = db.prepare('SELECT * FROM logins WHERE id = ?').get(String(id || ''))
  if (!row || row.expires < now()) return reply(res, 410, { error: 'The sign-in expired. Run /pokeidle login again.' })
  const r = await github('/login/oauth/access_token', {
    method: 'POST',
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, device_code: row.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  })
  if (r.error === 'authorization_pending') return reply(res, 202, { pending: true, interval: row.interval })
  if (r.error === 'slow_down') {
    db.prepare('UPDATE logins SET interval = ? WHERE id = ?').run(r.interval || row.interval + 5, row.id)
    return reply(res, 202, { pending: true, interval: r.interval || row.interval + 5 })
  }
  if (!r.access_token) {
    db.prepare('DELETE FROM logins WHERE id = ?').run(row.id)
    const why = r.error === 'access_denied' ? 'The sign-in was cancelled on GitHub.' : r.error === 'expired_token' ? 'The code expired.' : 'GitHub refused the sign-in.'
    return reply(res, 400, { error: why + ' Run /pokeidle login again.' })
  }
  // Who signed in; then GitHub's token is dropped: the server needs no access
  const userRes = await fetch(GITHUB_API + '/user', {
    headers: { authorization: 'Bearer ' + r.access_token, accept: 'application/vnd.github+json', 'user-agent': 'pokeidle-server' },
  })
  const user = await userRes.json()
  db.prepare('DELETE FROM logins WHERE id = ?').run(row.id)
  if (!user || !Number.isInteger(user.id) || !user.login) return reply(res, 502, { error: 'Could not read your GitHub account.' })
  db.prepare(`INSERT INTO players (github_id, login, created) VALUES (?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET login = excluded.login`).run(user.id, user.login, now())
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO tokens (token_hash, github_id, created, label) VALUES (?, ?, ?, ?)')
    .run(sha(token), user.id, now(), String(label || '').slice(0, 60))
  reply(res, 200, { token, login: user.login })
}

function logout(req, res, id) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '')
  db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha(m[1]))
  reply(res, 200, { ok: true })
}

// ---------- sync ----------

function getSave(req, res, id) {
  const row = db.prepare('SELECT save, saved_at FROM players WHERE github_id = ?').get(id)
  reply(res, 200, { save: row && row.save ? JSON.parse(row.save) : null, savedAt: row ? row.saved_at : null })
}

async function putSave(req, res, id) {
  const { save, team } = await readJson(req)
  if (!save || typeof save !== 'object' || !Array.isArray(save.party)) return reply(res, 400, { error: 'Not a save.' })
  const savedAt = Number(save.savedAt) || now()
  const row = db.prepare('SELECT saved_at FROM players WHERE github_id = ?').get(id)
  // The newest save wins; an older one gets the newer back so the client takes it
  if (row && row.saved_at && row.saved_at > savedAt) return getSave(req, res, id)
  const snap = cleanSnapshot(team)
  db.prepare('UPDATE players SET save = ?, saved_at = ?, team = coalesce(?, team), team_at = coalesce(?, team_at) WHERE github_id = ?')
    .run(JSON.stringify(save), savedAt, snap ? JSON.stringify(snap) : null, snap ? now() : null, id)
  reply(res, 200, { ok: true, savedAt })
}

// ---------- battles ----------

// Elo, so beating a stronger trainer counts for more
function elo(a, b, aWon) {
  const expected = 1 / (1 + 10 ** ((b - a) / 400))
  return Math.round(32 * ((aWon ? 1 : 0) - expected))
}

async function battle(req, res, id) {
  const { opponent } = await readJson(req)
  const login = String(opponent || '').trim().replace(/^@/, '')
  if (!LOGIN.test(login)) return reply(res, 400, { error: 'That is not a GitHub username.' })
  const me = db.prepare('SELECT * FROM players WHERE github_id = ?').get(id)
  const them = db.prepare('SELECT * FROM players WHERE login = ? COLLATE NOCASE').get(login)
  if (!them || !them.team) return reply(res, 404, { error: `@${login} has no PokeIdle team yet.` })
  if (them.github_id === id) return reply(res, 400, { error: 'You cannot battle yourself.' })
  if (!me || !me.team) return reply(res, 400, { error: 'Sync your game first, so the server has your team.' })
  const last = db.prepare('SELECT at FROM battles WHERE challenger = ? AND opponent = ? ORDER BY at DESC LIMIT 1').get(id, them.github_id)
  if (last && now() - last.at < REMATCH_MS) {
    const mins = Math.ceil((REMATCH_MS - (now() - last.at)) / 60000)
    return reply(res, 429, { error: `You battled @${them.login} recently. Rematch in ${mins} min.` })
  }
  const a = JSON.parse(me.team)
  const b = JSON.parse(them.team)
  const seed = crypto.randomInt(0, 2 ** 31)
  const result = pvpBattle(a, b, seededRng(seed))
  const winner = result.winner === 0 ? id : result.winner === 1 ? them.github_id : null
  if (winner) {
    const d = elo(me.rating, them.rating, winner === id)
    db.prepare('UPDATE players SET rating = rating + ?, wins = wins + ?, losses = losses + ? WHERE github_id = ?')
      .run(d, winner === id ? 1 : 0, winner === id ? 0 : 1, id)
    db.prepare('UPDATE players SET rating = rating - ?, wins = wins + ?, losses = losses + ? WHERE github_id = ?')
      .run(d, winner === id ? 0 : 1, winner === id ? 1 : 0, them.github_id)
  }
  const info = db.prepare('INSERT INTO battles (at, challenger, opponent, winner, seed, result) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now(), id, them.github_id, winner, seed, JSON.stringify(result))
  reply(res, 200, {
    id: Number(info.lastInsertRowid),
    you: a.name,
    them: b.name,
    opponent: them.login,
    won: winner === id,
    draw: !winner,
    prize: winner === id ? WIN_PRIZE : LOSS_PRIZE,
    ...result,
  })
}

function battles(req, res, id) {
  const rows = db.prepare(`SELECT id, at, challenger, opponent, winner, result FROM battles
    WHERE challenger = ? OR opponent = ? ORDER BY at DESC LIMIT 20`).all(id, id)
  reply(res, 200, {
    battles: rows.map((r) => {
      const mine = r.challenger === id
      const result = JSON.parse(r.result)
      return {
        id: r.id,
        at: r.at,
        opponent: loginOf(mine ? r.opponent : r.challenger),
        challenged: mine,
        won: r.winner === id,
        draw: !r.winner,
        turns: result.turns,
        summary: result.log.at(-1),
      }
    }),
  })
}

function ranking(req, res, id) {
  const rows = db.prepare(`SELECT github_id, login, rating, wins, losses, team FROM players
    WHERE team IS NOT NULL ORDER BY rating DESC, wins DESC LIMIT 20`).all()
  const me = db.prepare('SELECT login, rating, wins, losses FROM players WHERE github_id = ?').get(id)
  reply(res, 200, {
    me: me || null,
    top: rows.map((r) => {
      const t = JSON.parse(r.team)
      return { login: r.login, name: t.name, rating: r.rating, wins: r.wins, losses: r.losses, badges: t.badges, dex: t.dex }
    }),
  })
}

// Battles others started against this player while away, paid once
function inbox(req, res, id) {
  const rows = db.prepare(`SELECT id, challenger, winner, result FROM battles
    WHERE opponent = ? AND claimed = 0 ORDER BY at`).all(id)
  db.prepare('UPDATE battles SET claimed = 1 WHERE opponent = ? AND claimed = 0').run(id)
  reply(res, 200, {
    battles: rows.map((r) => ({
      id: r.id,
      challenger: loginOf(r.challenger),
      won: r.winner === id,
      draw: !r.winner,
      prize: r.winner === id ? WIN_PRIZE : 0,
      summary: JSON.parse(r.result).log.at(-1),
    })),
  })
}

const ROUTES = {
  'POST /login/start': [loginStart, false],
  'POST /login/poll': [loginPoll, false],
  'POST /logout': [logout, true],
  'GET /save': [getSave, true],
  'PUT /save': [putSave, true],
  'POST /battle': [battle, true],
  'GET /battles': [battles, true],
  'GET /ranking': [ranking, true],
  'GET /inbox': [inbox, true],
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true, github: !!GITHUB_CLIENT_ID })
  const route = ROUTES[`${req.method} ${path}`]
  if (!route) return reply(res, 404, { error: 'Not found.' })
  const [handler, needsAuth] = route
  try {
    if (needsAuth) {
      const id = playerFor(req)
      if (!id) return reply(res, 401, { error: 'Sign in first: /pokeidle login' })
      return await handler(req, res, id)
    }
    return await handler(req, res)
  } catch (e) {
    if (e.status) return reply(res, e.status, { error: e.message })
    console.error(e)
    reply(res, 500, { error: 'Server error.' })
  }
})

server.listen(PORT, () => console.log(`pokeidle server on :${PORT}${GITHUB_CLIENT_ID ? '' : ' (GITHUB_CLIENT_ID missing: sign-in is off)'}`))
