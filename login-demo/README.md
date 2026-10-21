# smart-table · 扫码登录实验场

一个 **Vue 3 + Vite** 的独立小工程，两种模式：

- **真微信（个人主体小程序）**：PC 页出真「小程序码」→ 微信扫码 → 小程序 `wx.login` → 服务端 `code2Session` 拿**真实 openid** → PC 轮询完成登录
- **模拟模式**：没配小程序 AppID 时的兜底，本地 mock 整套「扫码 → 确认 → 一次性 code → 会话」，用来练状态机

外加 **GitHub OAuth（真实协议）**：真实授权页、`state` 防 CSRF、code 换 token、拉 `/user`。

> 为什么不是网页二维码？个人身份做不了微信开放平台的「网站应用微信登录」。个人能做的是小程序，所以这里用小程序码把体验做到最接近：手机扫一下，电脑就登录了。
>
> 完整背景、资质门槛、方案对比见 [微信登录接入说明.md](./微信登录接入说明.md)。

## 快速开始

```bash
cd login-demo
pnpm install
pnpm dev
# 打开 http://127.0.0.1:5180
```

没配置小程序时，页面是「模拟模式」，点「模拟扫码 → 模拟确认」就能看到完整流程。

## 接入真微信（个人小程序，免费）

### 1. 注册小程序

[mp.weixin.qq.com](https://mp.weixin.qq.com) → 注册 → 选「小程序」→ 主体类型选**个人**（身份证 + 一个没注册过微信生态的邮箱，免费）。

### 2. 拿 AppID / AppSecret

小程序后台 → 开发管理 → 开发设置 → 开发者ID，复制 **AppID**，生成 **AppSecret**。

### 3. 填环境变量

```bash
cp .env.example .env
```

```ini
WX_MINI_APPID=wx********
WX_MINI_APPSECRET=********
WX_MINI_ENV=develop      # develop=开发版 / trial=体验版 / release=正式版
WX_MINI_PAGE=pages/login/login
```

重启 `pnpm dev`。刷新页面，微信标签页会自动从「模拟模式」切到**真小程序码**。

### 4. 导入小程序并上传一次

用**微信开发者工具**打开 `login-demo/miniprogram/`：

1. 把 `project.config.json` 里的 `appid` 改成你的 AppID
2. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
3. 点「上传」，版本号随便填（如 `0.0.1`）

> 必须上传过，开发版小程序码才能打开。扫码的微信必须是小程序的项目成员（你本人就是）。

### 5. 扫码

电脑页面出现小程序码 → 微信扫 → 小程序自动 `wx.login` 并把 openid 回填 → 电脑端 1.2 秒内完成登录，右侧会话面板显示**真实 openid**。

## 真机扫码的两个前提

- 手机和电脑在**同一局域网**，把 `miniprogram/config.js` 里的 `apiBase` 改成电脑的局域网地址，例如 `http://192.168.1.23:5180`（`pnpm dev` 启动时会打印 `Network:` 地址）
- 小程序打开后，右上角「…」→ **打开调试**，否则 http 请求会被域名校验拦掉

只想先在开发者工具里跑通？不用改 `apiBase`，默认 `http://127.0.0.1:5180` 即可。

## 真微信的登录链路

```
PC 浏览器                    dev server                       微信服务器
    │  POST /api/login/mini/ticket   │                              │
    │───────────────────────────────>│  cgi-bin/token               │
    │                                │─────────────────────────────>│
    │                                │  wxa/getwxacodeunlimit       │
    │                                │─────────────────────────────>│
    │<──── 小程序码 PNG + 票据id ─────│                              │
    │                                │                              │
    │  （手机扫码，打开小程序）        │                              │
    │                                │<── POST /mini/confirm ───────│ 小程序 wx.login
    │                                │  sns/jscode2session          │
    │                                │─────────────────────────────>│
    │                                │<── openid + session_key ─────│
    │<── 轮询：confirmed + code ──────│  票据置为 confirmed           │
    │  POST /api/login/mini/exchange  │                              │
    │───────────────────────────────>│  消费一次性 code（5 分钟）    │
    │<──── Set-Cookie + 真实 openid ──│                              │
```

`session_key` 只在服务端内存里用完即弃，不下发前端、不落库。

## 接口对照

| 本 demo | 真实微信接口 |
| --- | --- |
| `POST /api/login/mini/ticket` | `cgi-bin/token` + `wxa/getwxacodeunlimit` |
| `POST /api/login/mini/confirm` | `sns/jscode2session`（小程序 `wx.login` 的 code） |
| `POST /api/login/mini/exchange` | 无对应，服务端逻辑 |
| `GET /mock/wechat/connect/qrconnect` | `https://open.weixin.qq.com/connect/qrconnect`（网站应用，非个人） |
| `GET /mock/wechat/sns/oauth2/access_token` | `https://api.weixin.qq.com/sns/oauth2/access_token` |
| `GET /mock/wechat/sns/userinfo` | `https://api.weixin.qq.com/sns/userinfo` |

## 目录结构

```
login-demo/
├─ miniprogram/            # 个人小程序（原生 WXML/JS）
│  ├─ config.js            # apiBase：真机改成局域网 IP
│  └─ pages/login/login.*  # 扫码落点页：wx.login → 回填 openid
├─ server/
│  ├─ api.ts               # 路由：小程序码票据、轮询、confirm、exchange、mock、GitHub
│  ├─ wechat-mini.ts       # access_token / 小程序码 / code2Session 封装
│  ├─ mock-wechat.ts       # 模拟身份、一次性 code、access_token
│  ├─ state.ts             # 内存存储、HMAC 会话、cookie、限流
│  └─ phone-page.ts        # 模拟模式的“手机确认页”
├─ src/
│  ├─ App.vue              # 布局、模式切换、事件流
│  ├─ api.ts
│  └─ components/
│     ├─ MiniQrLogin.vue   # 真微信：小程序码 + 轮询
│     ├─ ScanLogin.vue     # 模拟模式
│     ├─ GithubLogin.vue
│     ├─ SessionPanel.vue
│     └─ EventLog.vue
└─ vite.config.ts          # dev 中间件挂载 /api、/mock、/phone
```

服务端没有独立进程：`configureServer` 把中间件挂进 Vite dev server。**dev-only**，生产要拆成独立服务。

## GitHub OAuth（可选）

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage：`http://127.0.0.1:5180`
3. Callback：`http://127.0.0.1:5180/api/auth/github/callback`
4. 把 Client ID / Secret 写进 `.env`，重启
5. 想验证 `state` 防护：清掉 cookie 再回跳，会落到 `state_mismatch`

## 安全设计（保留的）

- `code` 一次性 + 5 分钟过期，重复兑换 400
- GitHub 流程 `state` 校验（HttpOnly cookie）
- 会话 HttpOnly + `SameSite=Lax` + HMAC-SHA256 签名 + 24h 过期
- 票据 120 秒过期；创建票据、兑换 code 有限流
- `session_key` 不落库、不返回前端

## 刻意简化的（别照抄到生产）

- 全部状态在内存：重启 dev server 即清空
- 会话密钥每次启动随机，重启全员掉线
- 没有用户表、unionid 合并、refresh_token
- 没有审计、风控、设备指纹

## 已知限制

- **个人小程序拿不到 unionid**（需要绑定开放平台，个体户/企业才行），所以会话里 unionid 为空
- 开发版扫码要求扫码者是小程序项目成员；对外可用需上传体验版或发布
- 对外发布需要完成小程序备案
- 真机走 http 需要开调试模式；正式环境必须 https 合法域名
- 想做成「网页二维码扫码」（用户不装/不进小程序）只能走企业/个体户主体 + 开放平台认证

## 常见报错对照

| 现象 | 原因 |
| --- | --- |
| `40013 invalid appid` | AppID 填错，或 AppID 与 AppSecret 不是同一个小程序 |
| `40125 invalid appsecret` | Secret 填错，去后台重置后重新填 |
| `41030 invalid page` | `WX_MINI_PAGE` 指向的页面不存在 |
| 扫码提示「该小程序未发布 / 无权限」 | 开发版没上传，或扫码者不是项目成员 |
| 小程序里「网络失败」 | `config.js` 的 `apiBase` 不对、手机不在同一局域网、没开调试模式 |
| 页面显示「模拟模式」 | `.env` 没填或没重启 dev server |

## 授权范围提醒

个人小程序拿到的 openid 只能用于你自己这个小程序的账号体系。不要用它冒充「微信网页登录」，也不要把 openid 当作跨应用唯一标识。
