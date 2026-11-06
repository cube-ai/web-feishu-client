# Web飞书客户端

**定制化飞书Web客户端，远程接入 DSH 等远端智能体。**

「Web飞书客户端」是一个单用户、独立部署的飞书网页客户端。它通过飞书开放平台连接任意开通了飞书接入渠道的远端智能体（包含但不限于：DeepSeek Harness（DSH）、OpenClaw（龙虾）、WorkBuddy、WeKnora等等），让你在浏览器里使用飞书单聊的方式与远端智能体对话。

- 单管理员密码登录
- 多个飞书应用/机器人
- 一个应用对应一个单聊
- 文字、Markdown、表格、代码块
- 图片、文件、音频、视频
- 飞书卡片正文、普通按钮、审批按钮
- 固定侧栏 + 固定页眉，只有消息区滚动
- 数据默认保存在 `~/.web-feishu-client`

---

## 1. 环境要求

| 组件 | 要求 |
|---|---|
| Node.js | **24+**（需要内置 `node:sqlite`） |
| pnpm | **11+**（仓库声明 `pnpm@11.25.0`） |
| 飞书 | 企业自建应用，开启机器人能力 |
| 远端 | 开通飞书接入渠道，对于 DSH 是已安装并启动 `@cubeai/dsh-feishu-channels` 插件 |
| 网络 | 浏览器可访问本应用；OAuth 回调可回到本应用 |

不要求 Docker，也不要求单独安装数据库。

---

## 2. 安装

### 2.1 克隆代码

```bash
git clone https://openi.pcl.ac.cn/dsh/web-feishu-client.git
cd web-feishu-client
```

### 2.2 安装依赖

先确认 pnpm 可用（仓库声明 `pnpm@11.25.0`，11+ 即可）：

```bash
pnpm --version
```

如果提示找不到 pnpm，任选一种方式安装：

```bash
# 方式一：corepack（Node 自带；若提示没有 corepack 命令，用方式二）
corepack enable

# 方式二：直接安装 pnpm
npm install -g pnpm
```

然后安装依赖：

```bash
pnpm install --frozen-lockfile
```

### 2.3 构建

```bash
pnpm build
```

构建会生成：

- `apps/web/dist`：前端静态资源
- `apps/server/dist`：服务端 JavaScript

### 2.4 可选：配置环境变量

本地默认配置即可启动。需要修改监听地址、端口、外部 URL 或数据目录时：

```bash
cp .env.example .env
```

编辑 `.env`，至少确认：

```dotenv
HOST=127.0.0.1
PORT=8731
PUBLIC_BASE_URL=http://127.0.0.1:8731
```

`pnpm start` 会自动加载根目录的 `.env`。

### 2.5 启动

```bash
pnpm start
```

默认打开：

```text
http://127.0.0.1:8731
```

首次启动时，服务端控制台会输出一次性 setup token，同时写入：

```text
~/.web-feishu-client/setup-token.txt
```

如果控制台已经滚过去了，可以直接查看：

```bash
cat ~/.web-feishu-client/setup-token.txt
```

---

## 3. 第一次使用

### 3.1 设置管理员密码

打开：

```text
http://127.0.0.1:8731/setup
```

输入 setup token 和新的管理员密码。设置成功后：

- setup token 文件会被删除；
- 创建管理员 Session；
- 进入工作台；
- 以后从 `/login` 登录。

管理员密码使用 scrypt 哈希保存，不保存明文。

### 3.2 准备远端智能体

本应用只是飞书客户端，远端智能体必须已经能工作。以 DSH 为例：

1. 在目标 DSH 上安装并启用 `@cubeai/dsh-feishu-channels` 插件，左侧边栏会出现： `任务 | 飞书频道`。
2. 在 `飞书频道` 中添加飞书频道（会提示使用手机飞书客户端扫码创建）。
3. 确认飞书频道状态为长连接已建立。
4. 用手机飞书给这个机器人发一条消息，确认能收到回复。

### 3.3 添加机器人

进入本应用工作台：

1. 点击「添加飞书机器人」。
2. 填写显示名称、App ID、App Secret。以 DSH 为例，其中App ID和App Secret需要从远端 `@cubeai/dsh-feishu-channels` 插件的飞书频道设置中复制粘贴，名称也建议尽量与远端 `@cubeai/dsh-feishu-channels` 插件的飞书频道的名称保持一致。
3. 保存后点击「开始授权」。
4. 在飞书授权页使用**和机器人单聊的同一个飞书用户账号**登录并同意。
5. 授权成功后会自动尝试绑定单聊，并进入聊天页。

第一次绑定会由机器人发送一条设置消息，类似：

```text
Web飞书客户端：已绑定「你的机器人」。这条是设置消息，可忽略。
```

这条消息只用于取得单聊 `chat_id`，不会触发远端任务。

### 3.5 开始对话

绑定成功后即可在输入框发消息。

- Enter 发送
- Shift + Enter 换行
- 点击左下角回形针添加图片/文件
- 也可以直接粘贴剪贴板里的图片或文件
- 单条消息可以只有附件，也可以文字 + 附件

---

## 4. 功能

### 聊天

- 多机器人切换，左侧列表固定
- 固定页眉显示当前机器人、连接状态和设置入口
- 只有消息区滚动，输入框固定
- 消息时间、助手头像
- Markdown 标题、列表、引用、链接、表格、行内代码
- 代码块语言标签、语法高亮、复制、自动换行
- 表格内容宽度自适应，长表格内部横向滚动
- 图片灯箱、文件预览/下载、音频/视频播放器
- 卡片按钮和审批按钮
- 审批卡暖色面板 + 输入框上方常驻审批条

### 媒体

- 图片：原生飞书图片消息，最大 10MB
- 文件：原生飞书文件消息，最大 30MB
- 音频/视频：按文件消息发送，以兼容 `@cubeai/dsh-feishu-channels`
- 资源由服务端代理，浏览器不接触飞书 Token
- 文件资源支持 Range，可拖动音视频进度

### 应用设置

- 修改显示名称
- 进入对话（顶部显眼入口）
- 开始/重新授权
- 自动/重新绑定单聊
- 测试应用
- 删除机器人

### 安全

- 单管理员、无注册、无多用户
- HttpOnly Session Cookie
- CSRF Header 校验
- 登录和首次设置限流
- App Secret、用户 Token、Refresh Token 使用 AES-256-GCM 加密
- 媒体资源同源代理，不把 Token 暴露给浏览器

---

## 5. 消息同步方式

飞书不会主动把消息推送到这个独立网页端，因此当前采用轮询：

- 聊天页可见时，每 **5 秒**检查一次新消息
- 标签页隐藏/最小化时暂停
- 回到前台或窗口重新获得焦点时立即检查
- 离开聊天页后停止

这是有意的取舍：不引入 WebSocket，也不需要公网事件回调。若需要真正实时推送，后续可以接入飞书事件订阅 webhook 或长连接。

---

## 6. 配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8731` | 监听端口 |
| `PUBLIC_BASE_URL` | `http://HOST:PORT` | 外部访问地址，OAuth 回调基于它拼接 |
| `TRUST_PROXY` | `0` | 反向代理时设为 `1` |
| `REQUEST_LOGGING` | `0` | 是否输出 Fastify 逐请求日志 |
| `APP_SECRET_KEY` | 自动生成 | 32 字节 base64；生产建议显式配置 |
| `DATA_DIR` | `~/.web-feishu-client` | 数据目录 |
| `WEB_DIST` | `apps/web/dist` | 前端构建目录，一般不需要改 |

### 关于日志

默认关闭逐请求日志，避免聊天轮询刷屏。启动信息、首次 setup token 和服务端错误仍会输出。

临时查看请求日志：

```bash
REQUEST_LOGGING=1 pnpm start
```

---

## 7. 数据与备份

默认数据目录：

```text
~/.web-feishu-client/
├─ app.db              # SQLite：管理员、应用、Session、OAuth state
├─ master.key          # 未设置 APP_SECRET_KEY 时生成
└─ setup-token.txt     # 仅首次设置前存在
```

- 目录权限 `0700`
- 数据库和密钥文件 `0600`
- `DATA_DIR` 可覆盖默认位置

### 备份

至少备份：

```text
~/.web-feishu-client/app.db
~/.web-feishu-client/master.key
```

如果使用 `APP_SECRET_KEY` 环境变量，请把它和数据库分开保存在密码管理器或部署平台的 Secret 中。

**丢失 `master.key` / `APP_SECRET_KEY` 后，数据库里的 Secret 无法解密，需要重新填写 App Secret 并重新授权。**

### 重置

停止服务后删除整个数据目录：

```bash
rm -rf ~/.web-feishu-client
```

再次启动会回到首次 setup 状态，旧管理员、应用、Token、绑定关系全部清除。

---

## 8. 生产部署

应用本身只监听 HTTP，不实现 TLS。生产环境由 Nginx/Caddy 终止 HTTPS。

### 8.1 `.env` 示例

```dotenv
HOST=127.0.0.1
PORT=8731
PUBLIC_BASE_URL=https://feishu.example.com
TRUST_PROXY=1
NODE_ENV=production
APP_SECRET_KEY=请替换为32字节base64
```

`PUBLIC_BASE_URL` 必须与飞书后台重定向 URL 的域名和协议完全一致。

### 8.2 Nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name feishu.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:8731;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

要点：

- 必须传递 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`
- 上传体积至少 32MB
- 不需要 WebSocket
- 飞书后台重定向 URL 必须是 `https://feishu.example.com/api/oauth/callback`

### 8.3 启动方式

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

建议由 systemd、supervisor 或容器编排负责进程守护和重启。

### 8.4 升级

```bash
# 先停止服务并备份数据目录
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

---

## 9. 常见问题

### OAuth 回调报 `redirect_uri unmatch` / `2000`

`PUBLIC_BASE_URL` 与飞书后台“重定向 URL”不一致。检查：

- 协议是 http 还是 https
- 域名/IP 是否一致
- 是否包含 `/api/oauth/callback`
- `localhost` 和 `127.0.0.1` 不能混用

### 授权报 `20027`

用户身份权限没有开通或没有发布版本。检查：

- `im:message`
- `im:message.send_as_user`
- `offline_access`

然后重新创建版本并发布。

### 授权报 `20010`

当前飞书频道不在应用可用范围内。在开发者后台把该频道加入可用范围。

### 发消息报 `230027`

应用身份权限不足。检查：

- `im:message:send_as_bot`
- `im:message` / `im:message:readonly`

### 授权报 `99991679`

OAuth 授权缺少 `im:message.send_as_user`。确认权限并重新授权。

### 上传图片/文件失败

检查应用身份权限是否有 `im:resource`，并确认版本已发布。

### OAuth 完成后没有自动进入聊天

当前版本已修复这个问题：服务端在单聊绑定完成后才写入授权状态，前端会在页面重新获得焦点时立即检查。若仍出现：

1. 确认运行的是最新构建；
2. 不要只刷新静态页面，先 `pnpm build` 后重启服务；
3. 检查浏览器是否拦截了授权弹窗。

### 消息没有实时出现

这是 5 秒可见轮询，属于预期行为。切回页面会立即刷新。若需要真正的实时推送，需要后续接入飞书事件订阅。

### 端口被占用

```bash
EADDRINUSE: address already in use 127.0.0.1:8731
```

先停止占用 8731 的进程，或在 `.env` 中修改 `PORT`，同时同步修改 `PUBLIC_BASE_URL` 和飞书重定向 URL。

### 忘记管理员密码

当前没有网页找回流程。备份数据后删除 `~/.web-feishu-client` 重新初始化，或在数据库层面删除 `admin` 行并重启以重新生成 setup token。后者需要本机数据目录权限。

---

## 10. 已知限制

- 单用户、单实例，不支持团队共享。
- 一个飞书应用只对应一个单聊，不支持群聊。
- 语音/视频按文件消息发送，依赖远端 `@cubeai/dsh-feishu-channels` 的兼容处理。
- 卡片按钮是文字回退，不代理飞书原生 `card.action.trigger` 回调。
- 消息同步是可见时 5 秒轮询，不是真正的推送。
- 首版不做深色模式。
- 当前仓库没有 Dockerfile、自动化测试或 ESLint/Prettier 配置。

---

## 11. 开发

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm start
```

开发模式：

- 前端 Vite：`http://127.0.0.1:5173`
- 服务端 API：`http://127.0.0.1:8731`
- Vite 将 `/api` 代理到 8731

注意：`pnpm dev` 不会自动加载 `.env`，开发时需要手动导出环境变量，或使用默认配置。

### 目录

```text
apps/server/src/
├─ index.ts      Fastify 启动与路由
├─ config.ts     环境变量
├─ auth.ts       setup / 登录 / Session
├─ db.ts         SQLite schema
├─ secrets.ts    AES-GCM Secret Store
├─ apps.ts       应用 CRUD
├─ feishu.ts     OAuth / 消息 / 媒体 / 卡片
└─ http.ts       HTTP 错误与参数工具

apps/web/src/
├─ App.tsx       登录、壳层、聊天、设置
├─ api.ts        同源 API 客户端
├─ styles.css    Quiet Studio 样式
└─ main.tsx
```

---

## 12. 设计文档

更完整的产品边界、数据模型、API、飞书接入和验收清单见 [PLAN.md](PLAN.md)。

