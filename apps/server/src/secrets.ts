import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

function decodeKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) throw new Error('APP_SECRET_KEY 必须是 32 字节 base64')
  return key
}

function loadMasterKey(): Buffer {
  const fromEnv = process.env.APP_SECRET_KEY?.trim()
  if (fromEnv) return decodeKey(fromEnv)

  if (existsSync(config.masterKeyPath)) {
    const raw = readFileSync(config.masterKeyPath, 'utf8').trim()
    try { return decodeKey(raw) } catch {
      throw new Error(`${config.masterKeyPath} 格式无效；请恢复备份或重新配置 APP_SECRET_KEY`)
    }
  }

  const key = randomBytes(32)
  writeFileSync(config.masterKeyPath, key.toString('base64'), { mode: 0o600 })
  try { chmodSync(config.masterKeyPath, 0o600) } catch {}
  console.warn(`[secrets] 未设置 APP_SECRET_KEY，已生成 ${config.masterKeyPath}；请备份该文件，否则 Secret 无法恢复`)
  return key
}

export class SecretStore {
  private readonly key: Buffer

  constructor(private readonly db: DatabaseSync) {
    this.key = loadMasterKey()
  }

  set(ref: string, value: string): void {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(ref, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO secrets (ref, ciphertext, iv, tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        tag = excluded.tag,
        updated_at = excluded.updated_at
    `).run(ref, ciphertext, iv, tag, now, now)
  }

  get(ref: string): string | undefined {
    const row = this.db.prepare('SELECT ciphertext, iv, tag FROM secrets WHERE ref = ?').get(ref) as
      | { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }
      | undefined
    if (!row) return undefined
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv))
      decipher.setAAD(Buffer.from(ref, 'utf8'))
      decipher.setAuthTag(Buffer.from(row.tag))
      return Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]).toString('utf8')
    } catch {
      throw new Error('Secret 解密失败；请检查 APP_SECRET_KEY/master.key 是否与创建时一致')
    }
  }

  remove(ref: string): void {
    this.db.prepare('DELETE FROM secrets WHERE ref = ?').run(ref)
  }
}
