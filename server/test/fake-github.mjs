// A fake GitHub for the server test: each device code is approved on its second
// poll, and each access token belongs to one user
import http from 'node:http'

const USERS = [{ id: 101, login: 'Ash' }, { id: 202, login: 'gary' }]
const polls = {}
let started = 0

export function startFakeGithub(port) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = ''
      for await (const c of req) body += c
      const j = body ? JSON.parse(body) : {}
      res.setHeader('content-type', 'application/json')
      if (req.url === '/login/device/code') {
        const n = started++
        return res.end(JSON.stringify({ device_code: 'dc-' + n, user_code: 'CODE-' + n, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }))
      }
      if (req.url === '/login/oauth/access_token') {
        polls[j.device_code] = (polls[j.device_code] || 0) + 1
        if (polls[j.device_code] < 2) return res.end(JSON.stringify({ error: 'authorization_pending' }))
        return res.end(JSON.stringify({ access_token: 'tok-' + j.device_code.slice(3) }))
      }
      if (req.url === '/user') {
        const n = Number(req.headers.authorization.split('tok-')[1])
        return res.end(JSON.stringify(USERS[n]))
      }
      res.statusCode = 404
      res.end('{}')
    })
    server.listen(port, () => resolve(server))
  })
}
