import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { config } from './config.js'
import { openDatabase, type SessionRow } from './db.js'
import { AppsService } from './apps.js'
import { AuthService } from './auth.js'
import { FeishuService, type ChatAttachment } from './feishu.js'
import { HttpError, requireString } from './http.js'
import { SecretStore } from './secrets.js'

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const db = openDatabase(join(config.dataDir, 'app.db'))
const secrets = new SecretStore(db)
const auth = new AuthService(db)
const apps = new AppsService(db, secrets)
const feishu = new FeishuService(db, secrets)

const requestLogging = process.env.REQUEST_LOGGING === '1' || process.env.REQUEST_LOGGING?.toLowerCase() === 'true'
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL?.trim() || 'info' },
  trustProxy: config.trustProxy,
  bodyLimit: 1024 * 1024,
  logController: new LogController({ disableRequestLogging: !requestLogging }),
})

app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => {
  done(null, body)
})

await app.register(cookie)
await app.register(helmet, {
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'font-src': ["'self'", 'https:', 'data:'],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", 'https:', "'unsafe-inline'"],
      'upgrade-insecure-requests': config.secureCookies ? [] : null,
    },
  },
  hsts: config.secureCookies,
})
await app.register(rateLimit, { global: false })

function sessionOf(req: FastifyRequest): SessionRow | undefined {
  return auth.getSession(req.cookies[config.cookieName])
}

function requireSession(req: FastifyRequest, reply: FastifyReply): SessionRow | null {
  const session = sessionOf(req)
  if (!session) {
    void reply.code(401).send({ ok: false, error: '请先登录' })
    return null
  }
  return session
}

function assertCsrf(req: FastifyRequest, session: SessionRow): void {
  if (req.headers['x-remote-feishu-client'] !== '1') throw new HttpError(403, '缺少客户端标识')
  const token = req.headers['x-csrf-token']
  if (typeof token !== 'string' || token !== session.csrf_token) throw new HttpError(403, 'CSRF 校验失败')
  const origin = req.headers.origin
  if (origin && !config.allowedOrigins.has(origin)) throw new HttpError(403, 'Origin 不在允许范围内')
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  })
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.cookieName, { path: '/' })
}

function bodyOf(req: FastifyRequest): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return {}
  return req.body as Record<string, unknown>
}

function attachmentOf(value: unknown): ChatAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '附件信息无效')
  const item = value as Record<string, unknown>
  const kind = item.kind
  if (kind !== 'image' && kind !== 'file' && kind !== 'audio' && kind !== 'video') {
    throw new HttpError(400, '附件类型无效')
  }
  const resourceType = item.resourceType
  if (resourceType !== 'image' && resourceType !== 'file') throw new HttpError(400, '附件资源类型无效')
  const fileKey = typeof item.fileKey === 'string' ? item.fileKey.trim() : ''
  if (!fileKey) throw new HttpError(400, '附件 key 无效')
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 200) : '附件'
  const size = Number(item.size)
  const mime = typeof item.mime === 'string' ? item.mime.slice(0, 120) : undefined
  return {
    kind,
    resourceType,
    fileKey,
    name,
    ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    ...(mime ? { mime } : {}),
  }
}

auth.init()

app.get('/api/health', async (_req, reply) => {
  reply.header('cache-control', 'no-store')
  return { ok: true, name: 'web-feishu-client', version: '0.1.0' }
})

app.get('/api/auth/status', async (_req, reply) => {
  reply.header('cache-control', 'no-store')
  return { ok: true, needsSetup: auth.needsSetup() }
})

app.post('/api/auth/setup', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (req, reply) => {
  const body = bodyOf(req)
  const token = requireString(body.token, '设置 token', 200)
  const password = requireString(body.password, '密码', 200)
  const session = auth.setup({ token, password })
  setSessionCookie(reply, session.token)
  return { ok: true, csrfToken: session.csrfToken }
})

app.post('/api/auth/login', {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
}, async (req, reply) => {
  const body = bodyOf(req)
  const password = requireString(body.password, '密码', 200)
  const session = auth.login(password)
  setSessionCookie(reply, session.token)
  return { ok: true, csrfToken: session.csrfToken }
})

app.post('/api/auth/logout', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  try { assertCsrf(req, session) } catch (error) {
    if (error instanceof HttpError) {
      reply.code(error.status).send({ ok: false, error: error.message })
      return
    }
    throw error
  }
  auth.deleteSession(req.cookies[config.cookieName])
  clearSessionCookie(reply)
  return { ok: true }
})

app.get('/api/auth/me', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  reply.header('cache-control', 'no-store')
  return { ok: true, csrfToken: session.csrf_token, user: { role: 'admin' } }
})

app.get('/api/apps/:id/oauth/start', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  const { id } = req.params as { id: string }
  return { ok: true, ...(await feishu.startOAuth(id)) }
})

app.get('/api/oauth/callback', async (req, reply) => {
  const result = await feishu.handleCallback(new URL(req.url ?? '/', config.publicBaseUrl))
  reply
    .header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .type('text/html; charset=utf-8')
    .send(result.html)
})

app.post('/api/apps/:id/test', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  return { ok: true, ...(await feishu.testApp(id)) }
})

app.post('/api/apps/:id/chat', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  const body = bodyOf(req)
  feishu.setChat(id, requireString(body.chatId, 'Chat ID', 200))
  return { ok: true, app: apps.get(id) }
})

app.post('/api/apps/:id/media', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  const kind = query.get('kind') === 'image' ? 'image' : 'file'
  const name = query.get('name')?.slice(0, 200) || 'attachment'
  const mime = (query.get('mime')?.slice(0, 120) || String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]) || 'application/octet-stream'
  const body = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === 'string'
      ? Buffer.from(req.body)
      : null
  if (!body) throw new HttpError(400, '附件内容为空或格式不正确')
  if (kind === 'image' && body.length > 10 * 1024 * 1024) throw new HttpError(400, '图片不能超过 10MB')
  if (kind === 'file' && body.length > MAX_UPLOAD_BYTES) throw new HttpError(400, '附件不能超过 30MB')
  const attachment = await feishu.uploadMedia(id, kind, name, mime, body)
  return { ok: true, attachment }
})

app.get('/api/apps/:id/messages', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  const { id } = req.params as { id: string }
  return { ok: true, messages: await feishu.listMessages(id) }
})

app.post('/api/apps/:id/messages', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  const body = bodyOf(req)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text.length > 10_000) throw new HttpError(400, '消息不能超过 10000 字')
  if (body.attachment !== undefined) {
    return { ok: true, ...(await feishu.sendAttachment(id, text, attachmentOf(body.attachment))) }
  }
  if (!text) throw new HttpError(400, '消息不能为空')
  return { ok: true, message: await feishu.sendText(id, text) }
})

app.post('/api/apps/:id/discover', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  await feishu.discoverChat(id)
  return { ok: true, app: apps.get(id) }
})

app.get('/api/apps', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  reply.header('cache-control', 'no-store')
  return { ok: true, apps: apps.list() }
})

app.post('/api/apps', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const body = bodyOf(req)
  const created = apps.create({
    name: typeof body.name === 'string' ? body.name : undefined,
    appId: requireString(body.appId, 'App ID', 120),
    appSecret: requireString(body.appSecret, 'App Secret', 300),
  })
  reply.code(201)
  return { ok: true, app: created }
})

app.patch('/api/apps/:id', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  const body = bodyOf(req)
  return { ok: true, app: apps.rename(id, requireString(body.name, '名称', 60)) }
})

app.delete('/api/apps/:id', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  assertCsrf(req, session)
  const { id } = req.params as { id: string }
  apps.remove(id)
  return { ok: true }
})

app.get('/api/apps/:id/messages/:messageId/resources/:fileKey', async (req, reply) => {
  const session = requireSession(req, reply)
  if (!session) return
  const { id, messageId, fileKey } = req.params as { id: string; messageId: string; fileKey: string }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const type = url.searchParams.get('type') === 'file' ? 'file' : 'image'
  const download = url.searchParams.get('download') === '1'
  const name = (url.searchParams.get('name') || (type === 'image' ? 'image' : 'file')).replace(/[\r\n"]/g, '_').slice(0, 200)
  const range = type === 'file' && typeof req.headers.range === 'string' ? req.headers.range : undefined
  const response = await feishu.fetchResource(id, messageId, fileKey, type, range)
  const headers: Record<string, string> = {
    'content-type': response.headers.get('content-type') || 'application/octet-stream',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
  }
  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  const acceptRanges = response.headers.get('accept-ranges')
  if (contentLength) headers['content-length'] = contentLength
  if (contentRange) headers['content-range'] = contentRange
  if (acceptRanges) headers['accept-ranges'] = acceptRanges
  else if (type === 'file') headers['accept-ranges'] = 'bytes'
  reply.hijack()
  reply.raw.writeHead(response.status, headers)
  if (!response.body) {
    reply.raw.end()
    return
  }
  const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
  reply.raw.on('close', () => stream.destroy())
  stream.on('error', () => reply.raw.destroy())
  stream.pipe(reply.raw)
})

app.setErrorHandler((error, req, reply) => {
  if (error instanceof HttpError) {
    reply.code(error.status).send({ ok: false, error: error.message, ...(error.code ? { code: error.code } : {}) })
    return
  }
  req.log.error({ err: error }, 'request failed')
  reply.code(500).send({ ok: false, error: '服务器内部错误' })
})

const indexFile = join(config.webDist, 'index.html')
if (existsSync(indexFile)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    prefix: '/',
    wildcard: false,
    decorateReply: true,
  })
}

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    reply.code(404).send({ ok: false, error: '接口不存在' })
    return
  }
  if (existsSync(indexFile)) {
    reply.type('text/html; charset=utf-8').sendFile('index.html')
    return
  }
  reply.code(404).type('text/plain; charset=utf-8').send('前端尚未构建；开发时请使用 pnpm dev:web')
})

try {
  await app.listen({ host: config.host, port: config.port })
  console.log(`[server] listening on http://${config.host}:${config.port}`)
  console.log(`[server] public base: ${config.publicBaseUrl}`)
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`收到 ${signal}，正在关闭`)
  try { await app.close() } finally { db.close() }
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
