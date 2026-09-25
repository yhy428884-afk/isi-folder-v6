import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import sharp from 'sharp'

const PORT = Number(process.env.PORT || 3000)
const AUTH_DIR = path.resolve(process.env.AUTH_DIR || './session')
const PREFIX = process.env.PREFIX || '!'
const BOT_NAME = process.env.BOT_NAME || 'AMAR STR'
const OWNER_NAME = process.env.OWNER_NAME || 'AMAR'
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || '').replace(/\D/g, '')
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const MAX_TIKTOK_MB = Number(process.env.MAX_TIKTOK_MB || 45)
const SPOTIFY_DEFAULT_URL = process.env.SPOTIFY_DEFAULT_URL || 'https://open.spotify.com/track/2UgCs0i0rNHUH2jKE5NZHE'
const CHANNEL_LINK = (process.env.CHANNEL_LINK || '').trim()
const CHANNEL_JID = (process.env.CHANNEL_JID || '').trim()
let resolvedChannelJid = CHANNEL_JID
const MAX_EMOJI_COUNT = Math.min(50, Math.max(1, Number(process.env.MAX_EMOJI_COUNT || 30)))
const TMP_DIR = path.resolve(process.env.TMP_DIR || './tmp')

const logger = pino({ level: LOG_LEVEL })
const app = express()
let sock = null
let connected = false
let startedAt = Date.now()
let reconnectTimer = null
let pairingRequested = false
let pairingInterval = null

// One snake game per WhatsApp chat.
const games = new Map()
const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0]
}

await fs.mkdir(AUTH_DIR, { recursive: true })
await fs.mkdir(TMP_DIR, { recursive: true })

app.get('/health', (_req, res) => {
  res.status(connected ? 200 : 503).json({
    ok: connected,
    service: 'amar-str-bot',
    status: connected ? 'online' : 'connecting',
    uptime: Math.floor((Date.now() - startedAt) / 1000)
  })
})

app.get('/', (_req, res) => res.json({
  name: BOT_NAME,
  status: connected ? 'online' : 'connecting',
  health: '/health',
  features: ['snake', 'tiktok-downloader']
}))

app.listen(PORT, '0.0.0.0', () => logger.info(`HTTP server listening on ${PORT}`))

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedButtonId ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim()
}

function parseCommand(text) {
  if (!text.startsWith(PREFIX)) return null
  const body = text.slice(PREFIX.length).trim()
  if (!body) return null
  const parts = body.split(/\s+/)
  const command = parts.shift().toLowerCase()
  return { command, args: parts, raw: body }
}

function menuText() {
  return [
    `╭━━━〔 ${BOT_NAME} • BOT MENU 〕━━━╮`,
    `┃`,
    `┃ 🎮 GAME`,
    `┃ ${PREFIX}snake`,
    `┃ ${PREFIX}up / ${PREFIX}down`,
    `┃ ${PREFIX}left / ${PREFIX}right`,
    `┃ ${PREFIX}snake stop`,
    `┃`,
    `┃ 🎵 MEDIA`,
    `┃ ${PREFIX}tiktok <url>`,
    `┃ ${PREFIX}spotify <link>`,
    `┃ ${PREFIX}music <link>`,
    `┃`,
    `┃ ⚙️ BOT`,
    `┃ ${PREFIX}ping`,
    `┃ ${PREFIX}runtime`,
    `┃ ${PREFIX}info`,
    `┃`,
    `╰━━━━━━━━━━━━━━━━━━━━╯`,
    ``,
    `╭━━━〔 📢 SALURAN WHATSAPP 〕━━━╮`,
    `┃ ${PREFIX}emoji10🤩`,
    `┃ ${PREFIX}emoji 10 🤩`,
    `┃ Kirim emoji custom ke saluran`,
    `╰━━━━━━━━━━━━━━━━━━━━╯`
  ].join('\n')
}


async function verifiedStyleMenuCard() {
  const W = 1000, H = 1350
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 80)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="head" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#151b27"/><stop offset="1" stop-color="#28313f"/></linearGradient>
    <linearGradient id="accent" x1="0" x2="1"><stop stop-color="#19e6d0"/><stop offset="1" stop-color="#6a48ff"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="48" fill="#111820"/>
  <rect x="36" y="36" width="928" height="300" rx="38" fill="url(#head)" stroke="#344050" stroke-width="3"/>
  <circle cx="125" cy="132" r="68" fill="#263246" stroke="#19e6d0" stroke-width="4"/>
  <text x="125" y="151" text-anchor="middle" fill="#fff" font-family="Arial" font-size="62" font-weight="800">A</text>
  <text x="220" y="105" fill="#ffffff" font-family="Arial" font-size="38" font-weight="800">${esc(BOT_NAME)}</text>
  <circle cx="615" cy="93" r="19" fill="#168cff"/>
  <path d="M605 93 l7 7 l14 -17" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="220" y="151" fill="#9eabba" font-family="Arial" font-size="27">WhatsApp bot</text>
  <text x="220" y="196" fill="#91a0b2" font-family="Arial" font-size="24">Online • Railway</text>
  <rect x="70" y="245" width="860" height="1" fill="#3b4655"/>
  <text x="70" y="290" fill="#b7c2d0" font-family="Arial" font-size="22">Tampilan centang biru ini hanya desain kartu bot, bukan verifikasi resmi Meta.</text>

  <text x="72" y="405" fill="#ffffff" font-family="Arial" font-size="42" font-weight="800">AMAR STR MENU</text>
  <rect x="72" y="430" width="856" height="5" rx="3" fill="url(#accent)"/>
  <text x="95" y="510" fill="#27e8df" font-family="Arial" font-size="29" font-weight="700">✦ GAME</text>
  <text x="115" y="560" fill="#e5ebf2" font-family="Arial" font-size="27">${PREFIX}snake  — mulai Snake</text>
  <text x="115" y="605" fill="#aebaca" font-family="Arial" font-size="23">${PREFIX}up  ${PREFIX}down  ${PREFIX}left  ${PREFIX}right</text>
  <text x="95" y="685" fill="#27e8df" font-family="Arial" font-size="29" font-weight="700">✦ MEDIA</text>
  <text x="115" y="735" fill="#e5ebf2" font-family="Arial" font-size="27">${PREFIX}tiktok &lt;url&gt;  — download video</text>
  <text x="115" y="780" fill="#e5ebf2" font-family="Arial" font-size="27">${PREFIX}spotify &lt;link&gt;  — kartu musik</text>
  <text x="95" y="860" fill="#27e8df" font-family="Arial" font-size="29" font-weight="700">✦ BOT</text>
  <text x="115" y="910" fill="#e5ebf2" font-family="Arial" font-size="27">${PREFIX}ping   ${PREFIX}runtime   ${PREFIX}info</text>
  <text x="95" y="970" fill="#27e8df" font-family="Arial" font-size="29" font-weight="700">✦ SALURAN WHATSAPP</text>
  <text x="115" y="1020" fill="#e5ebf2" font-family="Arial" font-size="25">${PREFIX}emoji10🤩</text>
  <text x="115" y="1060" fill="#aebaca" font-family="Arial" font-size="22">Emoji custom • maksimum ${MAX_EMOJI_COUNT}</text>
  <rect x="72" y="1090" width="856" height="150" rx="32" fill="#17202c" stroke="#2e3b4c"/>
  <text x="100" y="1130" fill="#8f9eaf" font-family="Arial" font-size="21">OWNER</text>
  <text x="100" y="1170" fill="#ffffff" font-family="Arial" font-size="28" font-weight="700">${esc(OWNER_NAME)}</text>
  <text x="100" y="1210" fill="#8f9eaf" font-family="Arial" font-size="21">STATUS</text>
  <text x="205" y="1210" fill="#35e87f" font-family="Arial" font-size="24">● ONLINE</text>
  <text x="500" y="1210" fill="#8f9eaf" font-family="Arial" font-size="21">VERSION</text>
  <text x="630" y="1210" fill="#ffffff" font-family="Arial" font-size="24">Railway Ready</text>
  <text x="500" y="1305" text-anchor="middle" fill="#667589" font-family="Arial" font-size="19">Official verification remains controlled by Meta/WhatsApp.</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function formatRuntime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${d}d ${h}h ${m}m ${s}s`
}

function newGame() {
  const width = 13
  const height = 20
  return {
    width,
    height,
    snake: [{ x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }],
    dir: 'right',
    score: 0,
    level: 1,
    speed: 6.3,
    food: randomFood([], width, height),
    active: true
  }
}

function randomFood(snake, width, height) {
  const occupied = new Set(snake.map(p => `${p.x},${p.y}`))
  const free = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  return free[Math.floor(Math.random() * free.length)] || { x: 1, y: 1 }
}

function opposite(a, b) {
  return (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
}

function moveSnake(game, requestedDir) {
  if (!DIRECTIONS[requestedDir]) return false
  if (opposite(game.dir, requestedDir)) return false
  game.dir = requestedDir
  const [dx, dy] = DIRECTIONS[game.dir]
  const head = game.snake[0]
  const next = { x: head.x + dx, y: head.y + dy }

  if (next.x < 0 || next.x >= game.width || next.y < 0 || next.y >= game.height ||
      game.snake.some(p => p.x === next.x && p.y === next.y)) {
    game.active = false
    return true
  }

  game.snake.unshift(next)
  const ate = next.x === game.food.x && next.y === game.food.y
  if (ate) {
    game.score += 10
    game.level = 1 + Math.floor(game.score / 50)
    game.speed = Math.min(12, 6.3 + game.level * 0.7)
    game.food = randomFood(game.snake, game.width, game.height)
  } else {
    game.snake.pop()
  }
  return true
}

function gameGrid(game) {
  const snake = new Set(game.snake.map(p => `${p.x},${p.y}`))
  const head = game.snake[0]
  const lines = []
  for (let y = 0; y < game.height; y++) {
    let line = ''
    for (let x = 0; x < game.width; x++) {
      const key = `${x},${y}`
      if (head.x === x && head.y === y) line += '🟩'
      else if (snake.has(key)) line += '🟢'
      else if (game.food.x === x && game.food.y === y) line += '🍎'
      else line += '⬛'
    }
    lines.push(line)
  }
  return lines.join('\n')
}

async function snakeCard(game, title = 'Geometry Snake') {
  const W = 900, H = 1250, cell = 42, gx = 178, gy = 250
  const boardW = game.width * cell, boardH = game.height * cell
  const snake = new Set(game.snake.map(p => `${p.x},${p.y}`))
  const head = game.snake[0]
  let cells = ''
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      const key = `${x},${y}`
      const px = gx + x * cell + 2, py = gy + y * cell + 2
      if (head.x === x && head.y === y) cells += `<rect x="${px}" y="${py}" width="38" height="38" rx="8" fill="#37f3d0"/>`
      else if (snake.has(key)) cells += `<rect x="${px}" y="${py}" width="38" height="38" rx="8" fill="#6b43ff"/>`
      else if (game.food.x === x && game.food.y === y) cells += `<circle cx="${px+19}" cy="${py+19}" r="13" fill="#ff3e9d"/>`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#21e6d1"/><stop offset="1" stop-color="#8a43ff"/></linearGradient></defs>
  <rect width="100%" height="100%" rx="48" fill="#101625"/>
  <text x="72" y="95" fill="white" font-family="Arial" font-size="52" font-weight="700">${title}</text>
  <text x="600" y="95" fill="#21e6d1" font-family="Arial" font-size="58" font-weight="800">${String(game.score).padStart(4,'0')}</text>
  <text x="600" y="138" fill="#aeb8cb" font-family="Arial" font-size="24">BEST ${String(Math.max(game.score, Number(process.env.SNAKE_BEST || 0))).padStart(4,'0')}</text>
  <rect x="72" y="172" width="756" height="18" rx="9" fill="#283146"/><rect x="72" y="172" width="${Math.max(35, Math.min(756, 756 * (game.score % 50) / 50))}" height="18" rx="9" fill="url(#g)"/>
  <rect x="${gx-15}" y="${gy-15}" width="${boardW+30}" height="${boardH+30}" rx="32" fill="#08101c" stroke="#1e3447" stroke-width="4"/>
  ${cells}
  <text x="90" y="${gy+boardH+95}" fill="#dbe3ef" font-family="Arial" font-size="28">Level ${game.level}</text>
  <text x="620" y="${gy+boardH+95}" fill="#dbe3ef" font-family="Arial" font-size="28">Speed ${game.speed.toFixed(1)}x</text>
  <rect x="90" y="${gy+boardH+145}" width="720" height="90" rx="30" fill="#102f3a" stroke="#26d9d0" stroke-dasharray="12 10" stroke-width="3"/>
  <text x="330" y="${gy+boardH+202}" fill="#27e8e0" font-family="Arial" font-size="34" font-weight="700">⬆ ⬇ ⬅ ➡  TAP</text>
  <text x="450" y="1210" text-anchor="middle" fill="#7d8ca3" font-family="Arial" font-size="20">${game.active ? 'Ketik !up !down !left !right untuk bergerak' : 'GAME OVER — ketik !snake untuk mulai lagi'}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}


function isSpotifyTrackUrl(value) {
  try {
    const u = new URL(value)
    return u.hostname === 'open.spotify.com' && /^\/track\/[A-Za-z0-9]+/.test(u.pathname)
  } catch {
    return false
  }
}

function spotifyTrackId(value) {
  try {
    const u = new URL(value)
    const match = u.pathname.match(/^\/track\/([A-Za-z0-9]+)/)
    return match?.[1] || null
  } catch {
    return null
  }
}

async function getSpotifyTrack(url) {
  if (!isSpotifyTrackUrl(url)) throw new Error('Gunakan link track Spotify, contoh: https://open.spotify.com/track/...')
  const cleanUrl = new URL(url)
  cleanUrl.search = ''
  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl.toString())}`
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Spotify oEmbed HTTP ${response.status}`)
  const data = await response.json()
  return {
    id: spotifyTrackId(cleanUrl.toString()),
    title: data.title || 'Spotify Track',
    artist: data.author_name || 'Spotify',
    thumbnail: data.thumbnail_url || '',
    url: cleanUrl.toString()
  }
}

async function spotifyCard(track) {
  const W = 900, H = 1050
  const safe = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 70)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071b13"/><stop offset="1" stop-color="#0c3525"/></linearGradient>
    <linearGradient id="bar" x1="0" x2="1"><stop stop-color="#25d366"/><stop offset="1" stop-color="#a4ff65"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="48" fill="url(#bg)"/>
  <rect x="55" y="55" width="790" height="940" rx="42" fill="#07150f" stroke="#1f6f4a" stroke-width="3"/>
  <text x="90" y="120" fill="#76e6a8" font-family="Arial" font-size="28" font-weight="700">NOW PLAYING</text>
  <circle cx="450" cy="410" r="250" fill="#10291e" stroke="#2de77c" stroke-width="5"/>
  <circle cx="450" cy="410" r="190" fill="#0a1711" stroke="#1c4e36" stroke-width="3"/>
  <text x="450" y="430" text-anchor="middle" fill="#35e87f" font-family="Arial" font-size="110">♫</text>
  <text x="100" y="735" fill="white" font-family="Arial" font-size="42" font-weight="700">${safe(track.title)}</text>
  <text x="100" y="785" fill="#a9c9b7" font-family="Arial" font-size="28">${safe(track.artist)}</text>
  <rect x="100" y="835" width="700" height="12" rx="6" fill="#263a30"/>
  <rect x="100" y="835" width="220" height="12" rx="6" fill="url(#bar)"/>
  <text x="100" y="885" fill="#7f998b" font-family="Arial" font-size="22">Spotify</text>
  <text x="800" y="885" text-anchor="end" fill="#7f998b" font-family="Arial" font-size="22">OPEN IN SPOTIFY</text>
  <circle cx="450" cy="930" r="48" fill="#e9fff1"/>
  <text x="450" y="947" text-anchor="middle" fill="#0a1711" font-family="Arial" font-size="42">▶</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function sendSpotifyTrack(jid, url, quoted) {
  try {
    const track = await getSpotifyTrack(url)
    const card = await spotifyCard(track)
    const caption = [
      `🎧 *${track.title}*`,
      `👤 ${track.artist}`,
      '',
      '▶️ Buka di Spotify:',
      track.url,
      '',
      `💡 ${PREFIX}spotify <link> untuk track lain.`
    ].join('\n')
    await sock.sendMessage(jid, { image: card, caption }, { quoted })
  } catch (error) {
    logger.error({ err: error }, 'Spotify lookup failed')
    await sock.sendMessage(jid, { text: `❌ Gagal membaca link Spotify.\n${String(error.message).slice(0, 300)}` }, { quoted })
  }
}

function isTikTokUrl(value) {
  try {
    const u = new URL(value)
    return ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'].includes(u.hostname) || u.hostname.endsWith('.tiktok.com')
  } catch {
    return false
  }
}

function runYtDlp(url, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-playlist', '--no-warnings', '--restrict-filenames',
      '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/b',
      '--merge-output-format', 'mp4',
      '-o', outputPath,
      url
    ]
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', d => { stderr += d.toString().slice(-4000) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `yt-dlp exit ${code}`)))
  })
}

async function downloadTikTok(jid, url, quoted) {
  if (!isTikTokUrl(url)) {
    await sock.sendMessage(jid, { text: `❌ URL TikTok tidak valid.\nContoh: ${PREFIX}tiktok https://www.tiktok.com/@user/video/123...` }, { quoted })
    return
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const output = path.join(TMP_DIR, `${id}.%(ext)s`)
  await sock.sendMessage(jid, { text: '⏳ Mengunduh video TikTok...' }, { quoted })

  try {
    await runYtDlp(url, output)
    const files = await fs.readdir(TMP_DIR)
    const candidates = files.filter(f => f.startsWith(id + '.') && !f.endsWith('.part'))
    if (!candidates.length) throw new Error('File hasil download tidak ditemukan')
    const file = path.join(TMP_DIR, candidates[0])
    const stat = await fs.stat(file)
    if (stat.size > MAX_TIKTOK_MB * 1024 * 1024) {
      throw new Error(`Video terlalu besar (maks ${MAX_TIKTOK_MB} MB)`)
    }
    await sock.sendMessage(jid, {
      video: await fs.readFile(file),
      mimetype: 'video/mp4',
      caption: '✅ TikTok berhasil diunduh\nGunakan hanya untuk konten yang boleh kamu simpan.'
    }, { quoted })
    await fs.rm(file, { force: true })
  } catch (error) {
    logger.error({ err: error }, 'TikTok download failed')
    await sock.sendMessage(jid, { text: `❌ Gagal download TikTok.\n${String(error.message).slice(0, 500)}\n\nCoba URL TikTok publik lain.` }, { quoted })
  }
}

function extractEmojiCommand(command, args, raw) {
  // Supports: !emoji10🤩 and !emoji 10 🤩
  const compact = raw.match(/^emoji(\d+)([\s\S]*)$/i)
  if (compact) {
    const count = Number(compact[1])
    const emoji = compact[2].trim()
    return { count, emoji }
  }
  const count = Number(args[0])
  const emoji = args.slice(1).join(' ').trim()
  if (Number.isInteger(count) && emoji) return { count, emoji }
  return null
}

function getChannelInviteCode(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  try {
    const url = new URL(input)
    if (url.hostname !== 'whatsapp.com' && url.hostname !== 'www.whatsapp.com') return ''
    const match = url.pathname.match(/^\/channel\/([^/]+)/i)
    return match?.[1] || ''
  } catch {
    return input.replace(/^\/+/, '').split(/[/?#]/)[0]
  }
}

async function resolveChannelJid() {
  if (resolvedChannelJid?.endsWith('@newsletter')) return resolvedChannelJid
  const code = getChannelInviteCode(CHANNEL_LINK)
  if (!code || !sock?.newsletterMetadata) return ''
  const metadata = await sock.newsletterMetadata('invite', code)
  if (!metadata?.id?.endsWith('@newsletter')) throw new Error('Metadata saluran tidak mengembalikan JID @newsletter')
  resolvedChannelJid = metadata.id
  logger.info({ channelJid: resolvedChannelJid, channelName: metadata.name }, 'WhatsApp Channel resolved from CHANNEL_LINK')
  return resolvedChannelJid
}

async function sendChannelEmoji(jid, parsed, quoted) {
  const raw = parsed.raw
  const info = extractEmojiCommand(parsed.command, parsed.args, raw)
  if (!info || !info.emoji) {
    await sock.sendMessage(jid, { text: `📢 Format:\n${PREFIX}emoji10🤩\natau\n${PREFIX}emoji 10 🤩` }, { quoted })
    return
  }
  if (!Number.isInteger(info.count) || info.count < 1 || info.count > MAX_EMOJI_COUNT) {
    await sock.sendMessage(jid, { text: `❌ Jumlah emoji harus 1-${MAX_EMOJI_COUNT}.` }, { quoted })
    return
  }
  let target = jid?.endsWith('@newsletter') ? jid : ''
  if (!target) {
    try {
      target = await resolveChannelJid()
    } catch (error) {
      logger.error({ err: error }, 'Failed to resolve WhatsApp Channel from CHANNEL_LINK')
      await sock.sendMessage(jid, { text: `❌ CHANNEL_LINK tidak dapat diproses. Pastikan link berbentuk https://whatsapp.com/channel/<kode> dan akun bot memiliki akses admin/pengelola ke saluran.` }, { quoted })
      return
    }
  }
  if (!target) {
    await sock.sendMessage(jid, { text: `⚠️ CHANNEL_LINK belum diatur di Railway Variables. Isi dengan link Saluran WhatsApp, misalnya https://whatsapp.com/channel/0029...` }, { quoted })
    return
  }
  const payload = Array.from({ length: info.count }, () => info.emoji).join('')
  try {
    await sock.sendMessage(target, { text: payload })
  } catch (error) {
    logger.error({ err: error, target }, 'Failed to send emoji to WhatsApp Channel')
    await sock.sendMessage(jid, { text: `❌ Gagal mengirim ke saluran. Pastikan akun bot adalah admin/pengelola saluran.\n${String(error.message).slice(0, 300)}` }, { quoted })
    return
  }
  if (target !== jid) {
    await sock.sendMessage(jid, { text: `✅ ${info.count}× ${info.emoji} dikirim ke saluran.` }, { quoted })
  }
}

async function handleCommand(message) {
  const text = getText(message.message)
  const parsed = parseCommand(text)
  if (!parsed) return
  const jid = message.key.remoteJid
  if (!jid) return

  // Compact channel command: !emoji10🤩
  const compactEmoji = parsed.command.match(/^emoji\d+.+$/i)
  if (compactEmoji) {
    await sendChannelEmoji(jid, parsed, message)
    return
  }

  switch (parsed.command) {
    case 'menu': {
      const card = await verifiedStyleMenuCard()
      await sock.sendMessage(jid, { image: card, caption: menuText() }, { quoted: message })
      break
    }
      break
    case 'emoji': {
      await sendChannelEmoji(jid, parsed, message)
      break
    }
    case 'ping':
      await sock.sendMessage(jid, { text: `🏓 Pong!\n${BOT_NAME} aktif.` }, { quoted: message })
      break
    case 'runtime':
      await sock.sendMessage(jid, { text: `⏱️ Runtime: ${formatRuntime(process.uptime())}` }, { quoted: message })
      break
    case 'info':
      await sock.sendMessage(jid, { text: `🤖 ${BOT_NAME}\n👤 Owner: ${OWNER_NAME}\n🟢 Status: ${connected ? 'Online' : 'Connecting'}\n⚙️ Node: ${process.version}` }, { quoted: message })
      break
    case 'snake': {
      if (parsed.args[0]?.toLowerCase() === 'stop') {
        games.delete(jid)
        await sock.sendMessage(jid, { text: '🛑 Game Snake dihentikan.' }, { quoted: message })
        break
      }
      const game = newGame()
      games.set(jid, game)
      const card = await snakeCard(game)
      await sock.sendMessage(jid, { image: card, caption: '🎮 SNAKE\nKontrol: !up !down !left !right\nRestart: !snake' }, { quoted: message })
      break
    }
    case 'up': case 'down': case 'left': case 'right': {
      const game = games.get(jid)
      if (!game) {
        await sock.sendMessage(jid, { text: `🎮 Belum ada game. Ketik ${PREFIX}snake untuk mulai.` }, { quoted: message })
        break
      }
      if (!game.active) {
        await sock.sendMessage(jid, { text: `💥 Game Over! Skor: ${game.score}\nKetik ${PREFIX}snake untuk mulai lagi.` }, { quoted: message })
        break
      }
      moveSnake(game, parsed.command)
      const card = await snakeCard(game)
      await sock.sendMessage(jid, { image: card, caption: game.active ? `🎮 Score: ${game.score}\nArah berikutnya: ${game.dir}` : `💥 GAME OVER\nScore: ${game.score}\nKetik ${PREFIX}snake untuk mulai lagi.` }, { quoted: message })
      break
    }
    case 'spotify':
    case 'music': {
      const url = parsed.args[0] || SPOTIFY_DEFAULT_URL
      await sendSpotifyTrack(jid, url, message)
      break
    }
    case 'tiktok':
      if (!parsed.args[0]) {
        await sock.sendMessage(jid, { text: `🎵 Cara pakai:\n${PREFIX}tiktok https://www.tiktok.com/@user/video/...` }, { quoted: message })
      } else {
        await downloadTikTok(jid, parsed.args[0], message)
      }
      break
    default:
      break
  }
}

function scheduleReconnect(reason) {
  if (reconnectTimer) return
  logger.warn({ reason }, 'Connection closed; reconnecting in 5 seconds')
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try { await startBot() } catch (error) { logger.error({ err: error }, 'Reconnect failed'); scheduleReconnect('reconnect-failed') }
  }, 5000)
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  let waVersion
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    waVersion = version
    logger.info({ version, isLatest }, 'Using WhatsApp Web version')
  } catch (error) {
    logger.warn({ err: error }, 'Failed to fetch latest WA version, using library default')
  }
  sock = makeWASocket({
    auth: state,
    version: waVersion,
    browser: Browsers.ubuntu(BOT_NAME),
    printQRInTerminal: false,
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !PAIRING_NUMBER) {
      logger.info('Scan QR berikut dengan WhatsApp:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'connecting') { connected = false; logger.info('WhatsApp: connecting...') }
    if (connection === 'open') {
      connected = true; pairingRequested = false; startedAt = Date.now()
      if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null }
      logger.info(`✅ ${BOT_NAME} ONLINE`)
    }
    if (connection === 'close') {
      connected = false
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode ?? null
      logger.warn({ statusCode }, 'WhatsApp connection closed')
      if (statusCode === DisconnectReason.loggedOut) {
        if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null }
        logger.error('Session logged out. Delete persistent session and pair again.')
        return
      }
      scheduleReconnect(`code-${statusCode ?? 'unknown'}`)
    }
  })
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const message of messages) {
      try {
        if (!message.message || message.key.fromMe) continue
        if (message.key.remoteJid === 'status@broadcast') continue
        await handleCommand(message)
      } catch (error) { logger.error({ err: error }, 'Message handler error') }
    }
  })
  if (PAIRING_NUMBER && !state.creds.registered && !pairingRequested) {
    pairingRequested = true
    const requestCode = async () => {
      if (connected || state.creds.registered) return
      try {
        const code = await sock.requestPairingCode(PAIRING_NUMBER)
        logger.info(`🔐 PAIRING CODE: ${code}`)
        logger.info('WhatsApp > Linked devices > Link a device > Link with phone number')
        logger.info('Kode ini berlaku singkat. Kode baru akan diminta otomatis dalam 40 detik jika belum terhubung.')
      } catch (error) {
        logger.error({ err: error }, 'Failed to request pairing code')
      }
    }
    setTimeout(requestCode, 1500)
    pairingInterval = setInterval(requestCode, 40000)
  }
}

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
process.on('unhandledRejection', error => logger.error({ err: error }, 'Unhandled rejection'))
process.on('uncaughtException', error => logger.error({ err: error }, 'Uncaught exception'))

startBot().catch(error => { logger.error({ err: error }, 'Initial bot start failed'); process.exitCode = 1 })
