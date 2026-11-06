import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

function envFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

const host = process.env.HOST?.trim() || '127.0.0.1'
const port = Number(process.env.PORT || 8731)
const publicBaseUrl = (process.env.PUBLIC_BASE_URL?.trim() || `http://${host}:${port}`).replace(/\/+$/, '')
const defaultDataDir = resolve(homedir(), '.web-feishu-client')
const dataDir = resolve(process.env.DATA_DIR?.trim() || defaultDataDir)
const webDist = resolve(process.env.WEB_DIST?.trim() || resolve(repoRoot, 'apps/web/dist'))

export const config = {
  host,
  port,
  publicBaseUrl,
  dataDir,
  webDist,
  trustProxy: envFlag(process.env.TRUST_PROXY),
  isProduction: process.env.NODE_ENV === 'production',
  secureCookies: publicBaseUrl.startsWith('https://'),
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  setupTokenPath: resolve(dataDir, 'setup-token.txt'),
  masterKeyPath: resolve(dataDir, 'master.key'),
  cookieName: 'rdf_session',
  allowedOrigins: new Set([
    publicBaseUrl,
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://127.0.0.1:8731', 'http://localhost:8731', 'http://127.0.0.1:5173', 'http://localhost:5173']),
  ]),
}
