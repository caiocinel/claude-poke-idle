// PokeIdle server: email sign-in, save sync between machines, and battles
// between players. Node's built-in http and sqlite, no dependencies. The battle
// engine is the plugin's own, so a battle here plays exactly as in the game.

import http from 'node:http'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { sendMail } from './smtp.js'
import { cleanSnapshot, pvpBattle, seededRng } from './engine/engine.js'

const PORT = Number(process.env.PORT || 8090)
const DB_PATH = process.env.DB_PATH || './data/pokeidle.db'
const MAIL = {
  host: process.env.SMTP_HOST || '172.17.0.1',
  port: Number(process.env.SMTP_PORT || 25),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || 'pokeidle@smtp.caiocinel.com',
}
const CODE_TTL_MS = 10 * 60 * 1000
const MAX_SAVE_BYTES = 512 * 1024
// One battle against the same opponent per this long, so a team can't be farmed
const REMATCH_MS = 10 * 60 * 1000
const WIN_PRIZE = 1500
const LOSS_PRIZE = 300

const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    email TEXT PRIMARY KEY,
    created INTEGER NOT NULL,
    save TEXT,
    saved_at INTEGER,
    team TEXT,
    team_at INTEGER,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000
  );
  CREATE TABLE IF NOT EXISTS codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created INTEGER NOT NULL,
    label TEXT
  );
  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    challenger TEXT NOT NULL,
    opponent TEXT NOT NULL,
    winner TEXT,
    seed INTEGER NOT NULL,
    result TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS battles_by_player ON battles (challenger, at);
  CREATE INDEX IF NOT EXISTS battles_by_opponent ON battles (opponent, at);
`)

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const now = () => Date.now()
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i

// ---------- http helpers ----------

function reply(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(json)
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
  const row = db.prepare('SELECT email FROM tokens WHERE token_hash = ?').get(sha(m[1]))
  return row ? row.email : null
}

// A small in-memory limit per IP and per email, against code spam
const hits = new Map()
function limited(key, max, windowMs) {
  const t = now()
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs)
  list.push(t)
  hits.set(key, list)
  return list.length > max
}

function publicName(email) {
  const [user, domain] = email.split('@')
  return `${user.slice(0, 2)}…@${domain}`
}

// ---------- routes ----------

async function authStart(req, res) {
  const { email } = await readJson(req)
  const addr = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(addr)) return reply(res, 400, { error: 'That is not an email address.' })
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress
  if (limited('ip:' + ip, 10, 3600_000) || limited('mail:' + addr, 3, 900_000)) {
    return reply(res, 429, { error: 'Too many codes asked for. Try again later.' })
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  db.prepare(`INSERT INTO codes (email, code_hash, expires, tries, sent_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, tries = 0, sent_at = excluded.sent_at`)
    .run(addr, sha(addr + ':' + code), now() + CODE_TTL_MS, now())
  try {
    await sendMail({
      ...MAIL,
      to: addr,
      subject: `PokeIdle sign-in code: ${code}`,
      text: `Your PokeIdle sign-in code is ${code}\n\nType it into Claude Code to link this machine to your trainer.\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.\n`,
    })
  } catch (e) {
    console.error('mail failed', e.message)
    return reply(res, 502, { error: 'Could not send the email. Try again later.' })
  }
  reply(res, 200, { ok: true })
}

async function authVerify(req, res) {
  const { email, code, label } = await readJson(req)
  const addr = String(email || '').trim().toLowerCase()
  const row = db.prepare('SELECT * FROM codes WHERE email = ?').get(addr)
  if (!row || row.expires < now()) return reply(res, 400, { error: 'The code expired. Ask for a new one.' })
  if (row.tries >= 5) return reply(res, 429, { error: 'Too many wrong codes. Ask for a new one.' })
  if (row.code_hash !== sha(addr + ':' + String(code || '').trim())) {
    db.prepare('UPDATE codes SET tries = tries + 1 WHERE email = ?').run(addr)
    return reply(res, 400, { error: 'Wrong code.' })
  }
  db.prepare('DELETE FROM codes WHERE email = ?').run(addr)
  db.prepare('INSERT OR IGNORE INTO players (email, created) VALUES (?, ?)').run(addr, now())
  const token = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO tokens (token_hash, email, created, label) VALUES (?, ?, ?, ?)')
    .run(sha(token), addr, now(), String(label || '').slice(0, 60))
  reply(res, 200, { token, email: addr })
}

function getSave(req, res, email) {
  const row = db.prepare('SELECT save, saved_at FROM players WHERE email = ?').get(email)
  reply(res, 200, { save: row && row.save ? JSON.parse(row.save) : null, savedAt: row ? row.saved_at : null })
}

async function putSave(req, res, email) {
  const { save, team } = await readJson(req)
  if (!save || typeof save !== 'object' || !Array.isArray(save.party)) return reply(res, 400, { error: 'Not a save.' })
  const savedAt = Number(save.savedAt) || now()
  const row = db.prepare('SELECT saved_at FROM players WHERE email = ?').get(email)
  // The newest save wins; an older one comes back so the client can take it
  if (row && row.saved_at && row.saved_at > savedAt) return getSave(req, res, email)
  const snap = cleanSnapshot(team)
  db.prepare('UPDATE players SET save = ?, saved_at = ?, team = coalesce(?, team), team_at = coalesce(?, team_at) WHERE email = ?')
    .run(JSON.stringify(save), savedAt, snap ? JSON.stringify(snap) : null, snap ? now() : null, email)
  reply(res, 200, { ok: true, savedAt })
}

// Elo, so beating a stronger trainer counts for more
function elo(a, b, aWon) {
  const expected = 1 / (1 + 10 ** ((b - a) / 400))
  const delta = Math.round(32 * ((aWon ? 1 : 0) - expected))
  return delta
}

async function battle(req, res, email) {
  const { opponent } = await readJson(req)
  const other = String(opponent || '').trim().toLowerCase()
  if (other === email) return reply(res, 400, { error: 'You cannot battle yourself.' })
  const me = db.prepare('SELECT * FROM players WHERE email = ?').get(email)
  const them = db.prepare('SELECT * FROM players WHERE email = ?').get(other)
  if (!them || !them.team) return reply(res, 404, { error: `${other} has no PokeIdle team yet.` })
  if (!me || !me.team) return reply(res, 400, { error: 'Sync your game first, so the server has your team.' })
  const last = db.prepare('SELECT at FROM battles WHERE challenger = ? AND opponent = ? ORDER BY at DESC LIMIT 1').get(email, other)
  if (last && now() - last.at < REMATCH_MS) {
    const mins = Math.ceil((REMATCH_MS - (now() - last.at)) / 60000)
    return reply(res, 429, { error: `You battled ${other} recently. Rematch in ${mins} min.` })
  }
  const a = JSON.parse(me.team)
  const b = JSON.parse(them.team)
  const seed = crypto.randomInt(0, 2 ** 31)
  const result = pvpBattle(a, b, seededRng(seed))
  const winner = result.winner === 0 ? email : result.winner === 1 ? other : null
  if (winner) {
    const d = elo(me.rating, them.rating, winner === email)
    db.prepare('UPDATE players SET rating = rating + ?, wins = wins + ?, losses = losses + ? WHERE email = ?')
      .run(d, winner === email ? 1 : 0, winner === email ? 0 : 1, email)
    db.prepare('UPDATE players SET rating = rating - ?, wins = wins + ?, losses = losses + ? WHERE email = ?')
      .run(d, winner === other ? 1 : 0, winner === other ? 0 : 1, other)
  }
  const info = db.prepare('INSERT INTO battles (at, challenger, opponent, winner, seed, result) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now(), email, other, winner, seed, JSON.stringify(result))
  reply(res, 200, {
    id: Number(info.lastInsertRowid),
    you: a.name,
    them: b.name,
    won: winner === email,
    draw: !winner,
    prize: winner === email ? WIN_PRIZE : LOSS_PRIZE,
    ...result,
  })
}

function battles(req, res, email) {
  const rows = db.prepare(`SELECT id, at, challenger, opponent, winner, result FROM battles
    WHERE challenger = ? OR opponent = ? ORDER BY at DESC LIMIT 20`).all(email, email)
  reply(res, 200, {
    battles: rows.map((r) => {
      const res = JSON.parse(r.result)
      const mine = r.challenger === email
      return {
        id: r.id,
        at: r.at,
        opponent: mine ? r.opponent : r.challenger,
        challenged: mine,
        won: r.winner === email,
        draw: !r.winner,
        turns: res.turns,
        summary: res.log.at(-1),
      }
    }),
  })
}

function ranking(req, res, email) {
  const rows = db.prepare(`SELECT email, rating, wins, losses, team FROM players
    WHERE team IS NOT NULL ORDER BY rating DESC, wins DESC LIMIT 20`).all()
  const me = db.prepare('SELECT rating, wins, losses FROM players WHERE email = ?').get(email)
  reply(res, 200, {
    me: me ? { ...me, email } : null,
    top: rows.map((r) => {
      const t = JSON.parse(r.team)
      return { player: r.email === email ? email : publicName(r.email), name: t.name, rating: r.rating, wins: r.wins, losses: r.losses, badges: t.badges, dex: t.dex }
    }),
  })
}

// Prizes from battles you were challenged in while away, paid once
function inbox(req, res, email) {
  const rows = db.prepare(`SELECT id, challenger, winner, result FROM battles
    WHERE opponent = ? AND claimed = 0 ORDER BY at`).all(email)
  db.prepare('UPDATE battles SET claimed = 1 WHERE opponent = ? AND claimed = 0').run(email)
  reply(res, 200, {
    battles: rows.map((r) => ({
      id: r.id,
      challenger: r.challenger,
      won: r.winner === email,
      draw: !r.winner,
      prize: r.winner === email ? WIN_PRIZE : 0,
      summary: JSON.parse(r.result).log.at(-1),
    })),
  })
}

const ROUTES = {
  'POST /auth/start': [authStart, false],
  'POST /auth/verify': [authVerify, false],
  'GET /save': [getSave, true],
  'PUT /save': [putSave, true],
  'POST /battle': [battle, true],
  'GET /battles': [battles, true],
  'GET /ranking': [ranking, true],
  'GET /inbox': [inbox, true],
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true })
  const route = ROUTES[`${req.method} ${path}`]
  if (!route) return reply(res, 404, { error: 'Not found.' })
  const [handler, needsAuth] = route
  try {
    if (needsAuth) {
      const email = playerFor(req)
      if (!email) return reply(res, 401, { error: 'Sign in first: /pokeidle login' })
      return await handler(req, res, email)
    }
    return await handler(req, res)
  } catch (e) {
    if (e.status) return reply(res, e.status, { error: e.message })
    console.error(e)
    reply(res, 500, { error: 'Server error.' })
  }
})

server.listen(PORT, () => console.log(`pokeidle server on :${PORT}`))
