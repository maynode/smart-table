# 企业微信登录与消息

两件事互相独立，可分别开启：

1. **企业微信 OAuth 登录**（关闭时保留邮箱密码登录）；
2. **WeCom NotifyAdapter** 把自动化 `sendMessage` 发送到企微应用消息（同时始终保留站内通知）。

无凭证时可用 mock IdP / mock 通知端点跑完整集成测试，代码路径与真实 WeCom 相同。

## 登录

环境变量：

```env
WECOM_ENABLED=true
WECOM_CORP_ID=ww...
WECOM_SECRET=...
WECOM_AGENT_ID=1000002
WECOM_REDIRECT_URI=https://smart-table.example.com/login
```

接口：

| 接口 | 说明 |
| --- | --- |
| `GET /auth/wecom/config` | 公开；`{enabled, authorizeUrl, redirectUri}` |
| `POST /auth/wecom/callback` | `{code}` → 与邮箱登录相同的 `{accessToken,user}` |

流程：前端登录页读取 config，点击「企业微信登录」跳转 `authorizeUrl`；企微回调 `/login?code=...`，页面调用 callback 换取 JWT。

服务端用 `code` 换 `access_token`（`gettoken`）→ `auth/getuserinfo` 得 userid → `user/get` 得姓名/邮箱：

- 首次登录按 `wecomUserId` 建本地用户（无邮箱时用 `<userid>@wecom.local`，随机密码，不可密码登录）；
- 已有同邮箱账号时自动绑定 `wecomUserId`；
- 之后按 `wecomUserId` 幂等登录。

`users.wecom_user_id` 唯一索引；解绑/同步通讯录可后续扩展。

## 消息

`NOTIFY_ADAPTER` 由工厂选择：

- `WECOM_ENABLED=true` 或 `WECOM_MOCK_NOTIFY_URL` 非空 → `WecomNotifyAdapter`；
- 否则 → `LocalNotifyAdapter`（仅站内通知）。

自动化 `sendMessage`：

1. 事务内写 `notifications` 站内通知（始终执行）；
2. 调用 adapter；adapter 把本地 userId 映射到 `wecomUserId`，忽略未绑定用户；
3. mock 模式 POST `${WECOM_MOCK_NOTIFY_URL}/message` `{touser,title,text,agentid}`；
4. 真实模式获取/缓存 access_token，调用 `message/send` 文本消息。外部发送失败只告警，不回滚自动化运行。

## 测试

`apps/api/test/wecom-oauth.e2e-spec.ts` 启动本地 mock HTTP：

- `/token` 按 code 返回 userid/name/email → 验证 OAuth 登录幂等；
- `/message` 记录请求 → 验证自动化 sendMessage 经 WecomAdapter 投递。

设置：

```env
WECOM_ENABLED=true
WECOM_MOCK_IDP_URL=http://127.0.0.1:<port>
WECOM_MOCK_NOTIFY_URL=http://127.0.0.1:<port>
```

mock 端点只用于测试/联调，生产必须配置真实 corp id/secret/agent id。
