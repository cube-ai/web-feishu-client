#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const serverPkg = JSON.parse(readFileSync(join(root, 'apps/server/package.json'), 'utf8'))
const shortName = rootPkg.name.replace(/^@[^/]+\//, '')
const out = resolve(root, 'dist-release', `${shortName}-${rootPkg.version}`)

if (!existsSync(join(root, 'apps/server/dist/index.js'))) {
  console.error('缺少 apps/server/dist/index.js，请先运行 pnpm build')
  process.exit(1)
}
if (!existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.error('缺少 apps/web/dist/index.html，请先运行 pnpm build')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'apps/server'), { recursive: true })
mkdirSync(join(out, 'apps/web'), { recursive: true })

// Preserve the apps/<server|web>/dist layout: config.ts computes the web dist
// from the compiled server location, so a flat copy would not find it.
cpSync(join(root, 'apps/server/dist'), join(out, 'apps/server/dist'), { recursive: true })
cpSync(join(root, 'apps/web/dist'), join(out, 'apps/web/dist'), { recursive: true })
cpSync(join(root, '.env.example'), join(out, '.env.example'))
cpSync(join(root, 'README.md'), join(out, 'README.md'))
if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))

writeFileSync(join(out, 'package.json'), `${JSON.stringify({
  name: `${shortName}-release`,
  version: rootPkg.version,
  private: true,
  type: 'module',
  engines: rootPkg.engines,
  scripts: {
    start: 'node --env-file-if-exists=.env apps/server/dist/index.js',
  },
  dependencies: serverPkg.dependencies,
}, null, 2)}\n`)

writeFileSync(join(out, 'RUNNING.md'), `# ${shortName} ${rootPkg.version} 发布包

这是编译后的发布包，不包含 TypeScript 源码，不需要 pnpm、Vite 或 TypeScript。

## 运行

需要 Node.js 24 或更新版本。

\`\`\`bash
npm install --omit=dev
cp .env.example .env
# 按目标机器修改 .env 中的 HOST、PORT、PUBLIC_BASE_URL
npm start
\`\`\`

默认访问 \`http://127.0.0.1:8731\`。

## 数据目录

默认是 \`~/.web-feishu-client\`，包含 SQLite 数据库、会话、\`master.key\`
以及首次启动生成的 \`setup-token.txt\`。可以设置：

\`\`\`env
DATA_DIR=/absolute/path/to/web-feishu-data
\`\`\`

首次启动后，用 \`setup-token.txt\` 里的 token 在浏览器里设置管理员密码。已有数据
迁移时，请把 \`app.db\`、\`master.key\`、\`setup-token.txt\` 一起复制，并保持目录
\`0700\`、文件 \`0600\`。

## 飞书

- OAuth 回调按浏览器当前页面 base 拼接（origin + pathname，含路径前缀）：
  \`\${浏览器页面 base}/api/oauth/callback\`。
- 飞书开放平台的「重定向 URL」必须登记实际访问的 base；使用 localhost、
  127.0.0.1、局域网 IP、路径前缀或多个域名时，需要分别登记。
- \`PUBLIC_BASE_URL\` 用于 HTTPS 安全 Cookie 判断；在没有传 base 时也作为 OAuth
  回退。通过 HTTPS 反向代理访问时，把它设置为外部 HTTPS 地址。不再校验请求 Origin。
- 发布包只包含网页客户端，远端智能体仍需单独运行。
`)

console.log(out)
