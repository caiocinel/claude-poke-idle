// A minimal SMTP client: enough to send one plain-text email through the local
// Mail-in-a-Box. STARTTLS and AUTH LOGIN are used when SMTP_USER is set.

import net from 'node:net'
import tls from 'node:tls'

function session(socket) {
  let buf = ''
  let waiter = null
  const onData = (d) => {
    buf += d.toString('utf8')
    // A reply ends with a line whose 4th char is a space: "250 OK"
    const lines = buf.split('\r\n')
    const done = lines.findIndex((l) => /^\d{3} /.test(l))
    if (done >= 0 && waiter) {
      const reply = lines.slice(0, done + 1).join('\n')
      buf = lines.slice(done + 1).join('\r\n')
      const w = waiter
      waiter = null
      w(reply)
    }
  }
  socket.on('data', onData)
  const read = () => new Promise((resolve, reject) => {
    waiter = resolve
    socket.once('error', reject)
    onData(Buffer.alloc(0))
  })
  const cmd = async (line, expect) => {
    if (line !== null) socket.write(line + '\r\n')
    const reply = await read()
    if (!reply.startsWith(String(expect))) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'greeting'}: ${reply}`)
    return reply
  }
  return { cmd, off: () => socket.off('data', onData) }
}

export async function sendMail({ host, port, user, pass, from, to, subject, text }) {
  let socket = net.connect({ host, port })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.setTimeout(20000, () => socket.destroy(new Error('SMTP timeout')))
  let s = session(socket)
  await s.cmd(null, 220)
  await s.cmd('EHLO pokeidle', 250)
  if (user) {
    await s.cmd('STARTTLS', 220)
    s.off()
    socket = tls.connect({ socket, servername: host, rejectUnauthorized: false })
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })
    s = session(socket)
    await s.cmd('EHLO pokeidle', 250)
    await s.cmd('AUTH LOGIN', 334)
    await s.cmd(Buffer.from(user).toString('base64'), 334)
    await s.cmd(Buffer.from(pass).toString('base64'), 235)
  }
  await s.cmd(`MAIL FROM:<${from}>`, 250)
  await s.cmd(`RCPT TO:<${to}>`, 250)
  await s.cmd('DATA', 354)
  const body = [
    `From: PokeIdle <${from}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    // A line holding only a dot would end the message early
    ...text.split('\n').map((l) => (l.startsWith('.') ? '.' + l : l)),
  ].join('\r\n')
  await s.cmd(body + '\r\n.', 250)
  await s.cmd('QUIT', 221).catch(() => {})
  socket.end()
}
