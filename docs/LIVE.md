# Live Bus（全站自动更新）

> 单元格协同见 [COLLAB.md](./COLLAB.md)；离线提交见 [OFFLINE.md](./OFFLINE.md)。

## 1. 分工

| 通道 | 路径 | 职责 |
| --- | --- | --- |
| Collab OT | WS `/collab?token=&sheetId=` | 同行编辑、光标、`new_changes` |
| **Live Bus** | WS `/live?...` | 对象变更 → 客户端定向失效再拉 |
| 补洞 HTTP | `GET /bases/:id/live/since` · `GET /workspaces/:id/live/since` · `GET /live/me/since` · `GET /public-views/:token/live/since` · `GET /public/forms/:token/live/since` | 断线重连 / follower 补事件（公开接口仅公开安全 kind）；**每个 scope 历史流独立 seq**，客户端分游标补洞 |

默认策略：**写成功后发领域事件；客户端 debounce 后 refetch**。

## 2. 连接作用域

| 页面 | 查询参数 |
| --- | --- |
| 工作区首页 | `token` + `workspaceId` |
| Base 壳层 | `token` + `baseId` + `workspaceId` |
| 通知页 | `token`（仅用户房） |
| 公开视图 | `publicToken` |
| 公开填表 | `formToken` |

一连接可同时进 user / workspace / base 房；公开连接只收安全事件。

## 3. 事件帧

```ts
{
  type: 'live_event',
  eventId: string,
  seq: number,
  baseId: string | null,
  workspaceId: string | null,
  at: string,
  actorId: string | null,
  kind: string,
  entityId?: string,
  meta?: Record<string, unknown>
}
```

## 4. kind 一览（覆盖全站）

| 前缀 | 页面动作 |
| --- | --- |
| `workspace.*` | 首页工作区列表 |
| `base.*` | 首页 Base 卡片；Base 壳层 |
| `sheet.*` / `form.*` / `dashboard.*` / `analysis.*` | Base 侧栏与对应面板 |
| `automation.*` / `permission.changed` / `member.changed` | 自动化 / 权限 / 成员（含改头像/用户名 `meta.action=avatar|username`；协同栏另推 `user_newinfos`） |
| `comment.changed` | 评论抽屉 |
| `notification.*` | 铃铛 + 通知页（用户房；含邀请/ACL/自动化消息/表单提交/仪表盘推送） |
| `public_view.*` | 公开配置 + 公开页 |
| `view.changed` | 保存视图 CRUD |
| `template.changed` + 对象 `*.created` | 模板实例化后侧栏/首页 |
| `widget.changed` / `dashboard.updated` | 仪表盘增改删图表 |
| `form.published` | 分享开启时同步公开填表页 |
| `automation.run` | 自动化运行列表刷新；若步骤改写记录，另推 `sheet.rev_bumped` |
| `sheet.rev_bumped` | 仪表盘 / 公开页 / 打开中网格（Excel 导入、表单提交、REST 写记录、自动化改数） |
| `sheet.schema_changed` | 字段增删改 → Base 壳层 + **公开填表/公开视图**（公开安全） |
| `form.deleted` / `public_view.deleted` | 删宿主工作表级联后推给公开页 |

## 5. 多 Tab（P4）

同浏览器多个页签、**同一连接作用域**（`liveScopeKey`：base/workspace/user/public/form）：

| 角色 | 行为 |
| --- | --- |
| **Leader** | `navigator.locks` 持锁；唯一打开 `/live` WS；收到事件后 `BroadcastChannel(st-live-bus)` 镜像 |
| **Follower** | 不占 WS；订阅 BC；升主 `leader_hello` / 进房时走对应 scope 的 `live/since` 补洞；`eventId` 去重 |

无 `BroadcastChannel` / `locks` 时退化为每 Tab 自连（与 P3 相同）。实现：`live-tab-bridge.ts` + `live-socket.ts`。

## 6. 实现索引

- API：`apps/api/src/live/*`（Redis pub/sub，可 `LIVE_REDIS=0`）
- 写路径：`bases` / `workspaces` / sheets / forms / … `live.emit`
- Web：`live-socket.ts` · `live-bus.ts` · `live-tab-bridge.ts`；Home / BaseShell / Notifications / FormFill / PublicView + 各面板
- e2e：`apps/api/test/live-bus.e2e-spec.ts`；单测：`live-tab-bridge.spec.ts`

## 7. 验收

- 双浏览器首页：A 新建 Base，B 卡片无 F5 出现
- Base 内：侧栏 / 打开中面板自动刷新
- 通知页：新消息无刷新出现
- 公开填表：表单配置变更自动重载
- **同机两 Tab（同 Base / 同工作区）**：一侧变更，另一侧无 F5 一致；DevTools 可见仅 leader 持 `/live` WS
