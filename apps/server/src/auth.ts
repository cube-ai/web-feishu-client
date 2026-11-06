import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'
import type { AdminRow, SessionRow } from './db.js'
import { HttpError } from './http.js'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 200
const SETUP_TOKEN_TTL = 15 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1]!, 'base64')
    const expected = Buffer.from(parts[2]!, 'base64')
    const actual = scryptSync(password, salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export class AuthService {
  private setupToken: string | null = null
  private setupTokenCreatedAt = 0

  constructor(private readonly db: DatabaseSync) {}

  init(): void {
    this.cleanupSessions()
    if (this.getAdmin()) {
      this.removeSetupTokenFile()
      return
    }
    this.ensureSetupToken()
  }

  needsSetup(): boolean {
    return !this.getAdmin()
  }

  private getAdmin(): AdminRow | undefined {
    return this.db.prepare('SELECT id, password_hash, created_at FROM admin WHERE id = 1').get() as AdminRow | undefined
  }

  private ensureSetupToken(): string {
    if (this.setupToken && Date.now() - this.setupTokenCreatedAt < SETUP_TOKEN_TTL) return this.setupToken

    if (existsSync(config.setupTokenPath)) {
      const existing = readFileSync(config.setupTokenPath, 'utf8').trim()
      if (existing.length >= 32) {
        this.setupToken = existing
        this.setupTokenCreatedAt = Date.now()
        this.printSetupHint(existing)
        return existing
      }
    }

    const token = randomBytes(32).toString('base64url')
    writeFileSync(config.setupTokenPath, token, { mode: 0o600 })
    try { chmodSync(config.setupTokenPath, 0o600) } catch {}
    this.setupToken = token
    this.setupTokenCreatedAt = Date.now()
    this.printSetupHint(token)
    return token
  }

  private printSetupHint(token: string): void {
    console.log('\n============================================================')
    console.log('首次启动需要设置管理员密码')
    console.log(`  设置 token: ${token}`)
    console.log(`  打开:       ${config.publicBaseUrl}/setup`)
    console.log(`  文件:       ${config.setupTokenPath}`)
    console.log('============================================================\n')
  }

  private removeSetupTokenFile(): void {
    try { rmSync(config.setupTokenPath, { force: true }) } catch {}
  }

  setup(input: { token: string; password: string }): { token: string; csrfToken: string } {
    if (this.getAdmin()) throw new HttpError(409, '管理员已经设置，请直接登录')
    const expected = this.ensureSetupToken()
    if (!input.token || !safeEqual(input.token, expected)) throw new HttpError(400, '设置 token 无效')
    if (input.password.length < PASSWORD_MIN) throw new HttpError(400, `密码至少 ${PASSWORD_MIN} 位`)
    if (input.password.length > PASSWORD_MAX) throw new HttpError(400, '密码过长')

    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO admin (id, password_hash, created_at) VALUES (1, ?, ?)')
        .run(hashPassword(input.password), now)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw error
    }

    this.setupToken = null
    this.removeSetupTokenFile()
    return this.createSession()
  }

  login(password: string): { token: string; csrfToken: string } {
    const admin = this.getAdmin()
    if (!admin) throw new HttpError(409, '还没有设置管理员密码')
    if (!verifyPassword(password, admin.password_hash)) throw new HttpError(401, '密码错误')
    return this.createSession()
  }

  createSession(): { token: string; csrfToken: string } {
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(24).toString('base64url')
    const now = new Date()
    this.db.prepare('INSERT INTO sessions (id_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), csrfToken, now.toISOString(), new Date(now.getTime() + config.sessionTtlMs).toISOString())
    return { token, csrfToken }
  }

  getSession(token: string | undefined): SessionRow | undefined {
    if (!token) return undefined
    const row = this.db.prepare('SELECT id_hash, csrf_token, created_at, expires_at FROM sessions WHERE id_hash = ?')
      .get(hashToken(token)) as SessionRow | undefined
    if (!row) return undefined
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.deleteSession(token)
      return undefined
    }
    return row
  }

  deleteSession(token: string | undefined): void {
    if (!token) return
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token))
  }

  cleanupSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  }
}
