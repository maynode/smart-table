# 智能表格 — 剩余未完成清单（交接版）

> 更新日期：2026-10-28  
> 对照：`docs/智能表格-产品与技术方案.md`、`docs/COLLAB-SCALE.md`  
> 原则：**不以文档勾选代替验证**。本文件只记录「代码状态 + 可复现证据 + 仍缺什么」。

---

## 0. 一句话现状

W1–W4 功能主路径 + M12 缺口补齐 + UI 打磨 + P0 交付闭环已落地；相对企微网页版智能表格：**主能力已对齐**；私有化量产协同已收口。  
**当前主线（2026-10-28）：** **千人同表规模**（每表 Actor 串行合入 + 跨副本扇出 + 压测门槛）——方案见 [`docs/COLLAB-SCALE.md`](./COLLAB-SCALE.md)；**不要再扫造功能**；像素级视觉对齐 mock **不做**（产品指令）。  
**P0 已完成：** 全量 API e2e、前端 Playwright/vue-tsc/vitest、领码/网格/表单压测、`perf:window` 千万行；W6 见 `docs/FINAL-REPORT.md`。  
**已落地（同步/离线）：** MessageCenter + `commitchanges`；Nest `/collab` OT + 单元格短租约；`/live` + 多 Tab 镜像；千万行窗口 + skeleton + resize settle。  
**已落地（2026-10-27 PWA）：** 可安装壳 + chunk 本地库（Worker / cell-budget / 冷启动）+ 对象 Outbox（仪表盘布局/自动化定义/通知已读）+ 多面离线读缓存；见 `docs/OFFLINE.md` §0。提交 `558eb11`。  
**已落地（2026-10-28 量产硬化）：** 协同观感收口 + JWT 拒启 + `/ready` + metrics 门禁 + Redis 单元格锁/表单限流；提交 `359c0b0`。  
**待定（成熟后再议）：** 企微登录/通讯录/真企微群；`USER_C`；双人企微 `NEW_CHANGES` 实帧补抓（本仓按 SDK 推断建模）。

### 已知体验债 / 规模债（2026-10-28）

| # | 项 | 状态 | 说明 / 复现 |
|---|----|------|-------------|
| 1 | **拉伸窗口表格抖动** | **已收敛** | 拖边 CSS 拉伸上一帧 + 80ms settle 再 realloc；若仍抖，查外层 flex。 |
| 2 | **大表滚动 / 空白观感** | **已对齐 + chunk 本地库** | 块对齐预取 + skeleton + 持久化 chunk；见 `OFFLINE.md` §0 / `PERFORMANCE.md` §9。 |
| 3 | **实时协同观感** | **已达私有化量产** | Accept 2s+短熔断、冲突人话+OT rebase、锁拒绝/degraded toast、光标名牌常显+窗口定位、Redis 单元格锁、e2e 锁/冲突。见 `docs/COLLAB.md` §9。 |
| 3b | **千人同表规模** | **下一主线** | 每表 Actor 串行合入 + Redis 跨副本扇出 + 千连接压测。方案与切片：[`docs/COLLAB-SCALE.md`](./COLLAB-SCALE.md)。未达标前勿宣称千人同表。 |
| 4 | **表单 live 回刷盖编辑** | **已修（2026-10-28）** | 忽略自身 actor；公开 `/fill` 首屏快照后不跟 `form.updated`。 |
| 5 | **网格一点即编 / 行轴不同步** | **已修（2026-10-28）** | `gestureCell` 恢复两击进编；`records.length` 同步 `setRowCount`。 |
| 6 | **自动化开关不可点 / 仪表盘连点加图** | **已修（2026-10-28）** | switch input 铺满可点；加图 `addingWidget` 防重入。 |
| 7 | **成功页无自动化时空白** | **已修（2026-10-28）** | 默认模板「提交成功」；builder 文案说明优先级。 |

**下一 AI：** 只做 [`docs/COLLAB-SCALE.md`](./COLLAB-SCALE.md)（S1→S5）；勿再扫造功能；企微强绑定仍不做。

---

## 1. 已完成（代码 + 证据）

### W1 表格 / Canvas

| 能力 | 状态 | 位置 / 证据 |
|------|------|-------------|
| Canvas 多层渲染 + 行虚拟化保持 | 完成 | `apps/web/src/grid-canvas/engine.ts`、`CanvasGrid.vue`；`e2e/grid-canvas.spec.ts` 2/2 通过 |
| 列宽拖拽并持久化到 `field.options.width` | 完成 | `engine.ts` 的 `onColumnResize`、`GridPanel.vue` 的 `resizeField`；`e2e/grid-w1.spec.ts` 刷新后仍生效 |
| 字段删除（API+UI 确认） | 完成 | `DELETE /fields/:fieldId`；`GridPanel.vue`；W1 Playwright 校验字段消失 |
| 工作表重命名/删除 | 完成 | `PATCH/DELETE /sheets/:sheetId`；侧栏菜单 + 「更多」；W1 Playwright 通过 |
| 单选/多选选项编辑器（增删改颜色排序） | 完成 | `FieldOptionsEditor.vue`；W1 Playwright 新增选项后 API choices=3 |
| 多条件筛选（and/or）、多排序、多分组、多填色规则 | 完成 | `GridPanel.vue` 浮层；W1 Playwright 走真实 query，记录数 1/2 切换正确 |
| 人员字段选择工作区成员 | 完成 | `CanvasGrid.vue` person editor；W1 Playwright 选人后记录写入 member id |
| 图片/文件上传 + 格子展示 | 完成 | `POST /sheets/:sheetId/attachments`、`/files/uploads/:name`；W1 Playwright 上传后记录含文件 URL |
| 行多选 + 批量删除工具条 | 完成 | 行号点击选择；`selection-bar`；W1 Playwright 通过 |
| 命名视图保存/切换/重命名/删除 | 完成 | `SavedView` 模型、`views.controller.ts`、侧栏；W1 Playwright 保存/应用，W4 API CRUD 5/5 |
| 条件填色、行高、冻结列 | 完成 | 填色/行高 + **冻结列**（`freezeColumnCount` / 工具栏「冻结」） |

### W2 收集表单

| 能力 | 状态 | 位置 / 证据 |
|------|------|-------------|
| 可视化字段加入/移除/排序/必填 | 完成 | `FormBuilderPanel.vue`；W2 Playwright 通过 |
| 封面上传与预览 | 完成 | `POST /forms/:formId/cover`、`FormBuilderPanel.vue`；W2 Playwright 校验 `coverUrl` |
| 显示条件可视化编辑 + 公开表单动态显示 | 完成 | `shared` 的 `isFormFieldVisible`；公开接口返回全部配置字段，由前端按作答值判断；W2 Playwright「选到访后备注出现」通过 |
| 分享：启用、复制、二维码、范围、过期 | 完成 | 分享链接/QR/`audience`/`expiresAt`；W2 Playwright 校验 API 持久化 |
| 成功页模板编辑 + 变量 + 预览 | 完成 | 模板编辑器 + `form-success-preview`；W2 Playwright 显示示例姓名/SN |
| 序列号领取主路径 | 完成 | `e2e/serial-claim.spec.ts` 1/1 通过 |

### W3 自动化

| 能力 | 状态 | 位置 / 证据 |
|------|------|-------------|
| 创建/编辑/启停/删除 | 完成 | `AutomationEditor.vue`、`AutomationPanel.vue`；W3 Playwright 全部走 API 校验 |
| recordCreated / recordUpdated / schedule 触发 + 条件 | 完成 | 编辑器 + `automations.service.ts`；schedule 另见 W4 runner 测试 |
| findRecords（limit 默认 1）/ modifyRecords（绑定上一步）/ createRecord / sendMessage / startGroupChat / addGroupMembers | 完成 | 可视化步骤；群聊无凭证走 Local，但真实写入 `GroupChat.wecomChatId` 可测 |
| 步骤变量插入 | 完成 | 变量 chips；W3 插入 `{{序列号}}` 后生成消息文本 |
| 运行日志/步骤详情 | 完成 | 可展开 JSON；W3 校验 find/modify/sendMessage 三段 |
| UI 生成的 JSON 能跑通真实领取链路 | 完成 | W3 创建「查找未领→改状态→发消息」，建记录触发后码状态变 claimed，run=success |

### W4 平台补齐

| 能力 | 状态 | 位置 / 证据 |
|------|------|-------------|
| 命名视图持久化 filter/sort/group/rowHeight/colorRules | 完成 | `SavedView.query` JSON；W1/W4 测试 |
| 自动化 schedule 真实 runner（cron、原子 claim、nextRunAt） | 完成 | `automation-scheduler.service.ts` 15s 轮询 + `updateMany` 原子抢占；W4 API 测试断言只执行一次、nextRunAt 后移 |
| 顶栏「分享」接真实分享面板 | 完成 | `SharePanel.vue`；W4 Playwright 打开/关闭 |
| 顶栏「更多」真实菜单 | 完成 | 成员、重命名、公开视图、配额、开发者、导出、删表；无 `comingSoon`；W4 Playwright 从菜单进成员 |
| 成员邀请/改角色/移除 UI | 完成 | `MembersPanel.vue`；W4 Playwright 邀请→viewer→移除并核对 API |
| 企微群聊真 API / Local fallback | 完成 | `notify/wecom.adapter.ts`；`WECOM_ENABLED=false` 时本地群聊并写 `wecomChatId` |
| 仪表盘多图拖拽/缩放布局 | 完成 | 12 列 bento、拖拽重排、宽高持久化、删除；W4 Playwright 两图、加宽 w=8、增高 h=4、删除后剩 1 |
| 仪表盘定时推送创建/立即执行 | 完成 | `dashboard-schedule-*`；W4 Playwright run 显示 success |

### 构建 / 单测状态

- `pnpm --filter api build`：通过（最近一次 W4 修改后重跑）。
- `pnpm --filter shared test`：cron 18/18 通过（本文件更新时未改 shared）。
- `pnpm --filter web exec playwright test`：见第 3 节“本轮新鲜结果”；分套件 W1/W2/W3/W4 + serial + grid 均通过。
- `apps/api/test/w4-platform.e2e-spec.ts`：5/5 通过（saved views、attachment、字段删除、schedule 只跑一次、sheet rename/delete）。

---

## 2. 下一步要做（下一 AI 从这里继续）

> 功能主路径 + P0/P1 + PWA/离线已齐；**不要再扫一遍造功能**。

### 当前唯一主线：协同观感

| # | 项 | 状态 | 说明 |
|---|----|------|------|
| 1 | **双人同编流畅度** | **待做** | 延迟、接受回执、远端 `new_changes` 上屏节奏；对照 `COLLAB.md` |
| 2 | **冲突 / 锁提示** | **待做** | 单元格短租约失败、`COMMIT_VERSION_CONFLICT` 表面化文案与恢复 |
| 3 | **光标 / 在线叠层** | **待做** | 少遮挡、可扫读；勿为装饰加重绘 |
| 4 | **回归** | **必做** | 改协同后跑相关 API/Playwright；勿静默降级离线 flush |

可选补证据：本机起 API `:3000` + web `:5173` 后 `pnpm --filter web exec playwright test e2e/offline-sync.spec.ts`（含 cold reload）。

### P0 交付闭环（已归档）

| # | 项 | 状态 | 说明 |
|---|----|------|------|
| 1 | **全量 API e2e** | **已完成（2026-10-23）** | 20/20 套件、47/47；需 Redis `:6380`；建表 `seed: false` |
| 2 | **前端回归** | **已完成（2026-10-23）** | `vue-tsc`；vitest；Playwright 9/9 |
| 3 | **新鲜压测报告** | **已完成（2026-10-26）** | 领码 / grid / form + `perf:window` p95≈78ms |
| 4 | **Docker 镜像与源码一致** | **已完成（2026-10-26）** | `docker compose build` + `smoke:compose` |
| 5 | **W6 最终报告** | **已完成（2026-10-26）** | `docs/FINAL-REPORT.md` |
| 6 | **PWA + chunk 本地库** | **已完成（2026-10-27）** | `558eb11`；见 `OFFLINE.md` §0 |

### P1 体验弱差 — 已完成（2026-10-22）

| # | 项 | 状态 | 说明 / 证据 |
|---|----|------|-------------|
| 1 | **高频屏视觉对照** | **已完成** | 网格底栏记录数 + 右侧 icon 工具；表单居中下划线 Tab；自动化第1步时间线 + 中性 chip；仪表盘配置下划线 Tab + 预览区「取消/添加」。对照 `SCREENSHOT-INDEX` IA，非像素闸 |
| 2 | **仪表盘 NUMBER 卡加深** | **已完成** | 对比期 mom/yoy、趋势 sparkline、条件格式色、前后缀/小数位；`metric-widget` 单测 4/4；`charts.e2e` 含 NUMBER 用例；配置面在 `DashboardPanel` 指标卡分支 |

### P1 已完成归档（勿重做）

| 项 | 状态 | 说明 |
|----|------|------|
| 排序 mode option / natural | **已完成** | `buildSortSql`：option=choices 下标、natural=数字段补零；views + findRecords；GridPanel 三档；单测 + view-query e2e |
| ClickHouse ETL | **已完成** | `ClickHouseEtlService` 增量同步；需 `ANALYTICS_ADAPTER=clickhouse`；见 VERIFY-M12 |
| 高频屏视觉 / NUMBER 卡深度 | **已完成** | 见上表；勿再扫造功能 |
| 冻结列 / 站内消息 / 评论@ / NL 自动化卡 / autoNumber·ai / 复制粘贴填充 / 父子层级 / 关联·公式·lookup / 地理·条码·群聊格 / 自动化条件 / 变量树·消息按钮 / 表单·自动化交互对齐 / 字段显隐 / 内容权限钻取 / 仪表盘配置壳·图表全集 / 模板库壳 | **已完成** | 详见 §1 与 VERIFY-INDEX |

### P2 客观限制（低优先）

| 项 | 说明 |
|----|------|
| OTel / K8s 完整度 | 仅骨架；无完整集群清单 / Ingress / 有状态组件 |

### 待定（故意不做 / 暂缓 — 成熟稳定后再议，未排期）

> 状态统一标 **待定**：当前实现路径跳过；**不是缺口遗漏**。若要做，须单独立项，不得混进 P0/P1 / UI 打磨。  
> **阶段约定（2026-10-24）：** 先打磨现有能力；下列项等产品成熟稳定后再立项。

| 项 | 状态 | 说明 |
|----|------|------|
| 断网感知 / 恢复后自动重连或重试 | **已完成（2026-10-26）** | `NetworkError`、`online`/`offline`、壳层 `sync-banner`、恢复自动 `flush` |
| 离线编辑 / 本地队列 / 回放提交 | **已完成（2026-10-26）** | MessageCenter + IndexedDB + `POST /sheets/:id/commitchanges`；幂等 `clientOpId`；公开表 `Idempotency-Key`；见 `docs/OFFLINE.md` |
| 多人实时协同（OT / WS / `NEW_CHANGES`） | **已完成（2026-10-26）** | Nest `/collab`：`client_ready`/`heart_beat`/`user_changes`/`accept_commit`/`new_changes`/`cursor`；`sheet_rev`+changeset；共享 OT；在线 MessageCenter→WS，降级 HTTP；见 `docs/COLLAB.md` |
| Live Bus（全站自动更新） | **已完成（2026-10-26）** | Nest `/live` 支持 workspace/base/user/public/form；首页·Base·通知·公开页·填表全覆盖；含通知/模板/视图/Excel/表单提交/图表增删；`GET bases|workspaces/.../live/since`；见 `docs/LIVE.md` |
| Live Bus 多 Tab 镜像（P4） | **已完成（2026-10-26）** | 同 scope `BroadcastChannel` + `navigator.locks` 单 leader WS；follower 镜像 + `live/since` 补洞；见 `docs/LIVE.md` §5 |
| 跨端 / 多会话数据同步 | **部分完成** | 同表多会话由 WS `new_changes` 对齐；跨设备离线队列仍走 OFFLINE 回放 |
| 企微登录 | **待定** | 产品用本系统自有账号；不做企微 OAuth 强绑定登录 |
| 企微通讯录 / 联系人 | **待定** | 用本系统工作区成员表达同类语义 |
| 真企微群聊 | **待定** | 自动化群聊走 Local fallback / `wecomChatId`；真企微群 API 不强制 |
| AI BI（仪表盘 Agent / 智能分析） | **已完成（2026-10-26）** | 分析报告：对话 + digest/LLM Markdown（`docs/ANALYSIS-REPORT.md`）；仪表盘内 Agent：对话 + 增删改图表/布局，事务落库 + Live（`docs/DASHBOARD.md` §5）。不做企微 `smartsheet-bi` 协议孪生 |
| `USER_C` 字段 | **待定** | 材料语义不清；主类人员用 `person`（USER） |
| 大表 chunk 本地库 | **已完成（2026-10-27）** | IDB v2 `record_chunks` + Sync Worker + cell-budget；见 `OFFLINE.md` §0 |

### 产品目标与边界（2026-10-22 对齐；2026-10-24 补阶段）

**目标：** 功能上**完全复刻企业微信网页版智能表格**（工作表 / 表单 / 视图 / 自动化 / 仪表盘 / 权限等），登录用本系统自有账号；在此之上可做更强能力（例：提交后用户页可见消息通知）。

**阶段：** UI 打磨清单已勾完；断网/PWA/离线与协同**协议**已按 `OFFLINE.md` / `COLLAB.md` 落地；**体验主线仅剩协同观感**。

**其它产品边界（亦待定，非本期）：** 可编辑公网外链、多区域多活、短信验证码；不以飞书/Airtable 为对标。

**技术路径：** Vue Canvas + Nest REST/WS；企微 HAR/`wecom-js` 对照能力与 OT 符号；协议自洽不要求 Engine.IO 孪生。待定项见上表。

### 企微实时协作：已了解程度（2026-10-26 更新）

材料：`HAR-TECH-ANALYSIS.md` §8 / §12；单人实帧 `materials/live-ws-user-changes.redacted.json`；OT 符号 `materials/wecom-ot-transforms.extracted.json`；本仓 `docs/COLLAB.md`。

| 能还原 / 已落地 | 仍缺 |
|--------|------|
| 在线 `USER_CHANGES` → `ACCEPT_COMMIT` → 对端 `NEW_CHANGES`（本仓语义） | 双会话企微 `NEW_CHANGES` **完整实帧**（仍按 SDK 推断） |
| MessageCenter 在线 WS / 离线 HTTP；`sheet_rev` + changeset | 跨 sheet `notCrossSheet:false` 复杂包 |
| 心跳、进房、光标、在线成员、`COMM_NOTICE` dirty | 公式 zip / zlib 孪生（服务端重算即可） |

**补证据（可选）：** 同账号双浏览器同表抓 `NEW_CHANGES` 脱敏入库后替换 COLLAB「推断」节。

---

## 3. 本轮新鲜验证结果

| 命令 | 结果 |
|------|------|
| `pnpm --filter web exec vitest run` | **30/30 passed（2026-10-27）** — 含 `chunk-math` / `offline-capability` / `record-window` |
| `pnpm --filter web exec vite build` | **passed（2026-10-27）** — 含 PWA `sw.js` / precache |
| `pnpm --filter web exec vue-tsc --noEmit` | **passed（2026-10-23）**（历史；PWA 切片未清掉既有非本切片 TS 债） |
| `pnpm --filter api test:e2e --runInBand` | **20/20 suites、47/47 passed（2026-10-23）** |
| 全量 Playwright | **9/9 passed（2026-10-23）**；`offline-sync` 含 cold reload 用例，**需本机 API+web 再跑** |
| `claim-load` / `perf:grid` / `perf:form` / `perf:window` | 见 `PERFORMANCE.md`（window 2026-10-26 p95≈78ms） |
| `pnpm --filter shared test` | 18/18（cron；历史） |

---

## 4. 启动 / 验收

```bash
# 依赖与数据库
pnpm install
pnpm --filter shared build
pnpm --filter api prisma:migrate   # 或 npx prisma migrate deploy

# 本地开发（验收以这套为准）
pnpm --filter api start            # :3000
pnpm --filter web dev              # :5173

# 测试
pnpm --filter shared test
pnpm --filter api test:e2e --runInBand
pnpm --filter web exec playwright test
```

验收路径：

1. `http://127.0.0.1:5173` 登录。
2. 侧栏进入工作表：加字段/改选项/拖列宽→刷新仍在/多条件筛选/人员/图片/行多选/保存命名视图。
3. 「收集表单」：改字段顺序/必填/封面/显示条件/分享链接/成功页预览。
4. 「自动化」：新建查找→修改→发消息，建记录触发，查看 run 详情。
5. 「仪表盘」：加两种图、拖宽/增高/删除、定时推送执行。
6. 「分享」「更多」：无假入口。
7. 模板序列号：公开填表→成功页出码→后台自动化 run success。

---

## 5. 相关文档

- 交接提示词：`docs/HANDOFF-PROMPT-FOR-NEXT-AGENT.md`
- 产品方案：`docs/智能表格-产品与技术方案.md`
- 实施计划：`docs/superpowers/plans/2026-10-20-phase0-1-core-serial-claim.md`
- 性能：`docs/PERFORMANCE.md`
- **企微源码级校验**：总表 [`VERIFY-INDEX.md`](design-refs/wecom/smart-table/VERIFY-INDEX.md)（M1–M12 + 首轮 VERIFY-01…05）；路径 `docs/design-refs/wecom/smart-table/`
- **M12 缺口补齐**：`recordTimer`、CH ETL、Canvas breakLine、`title` 字段、双向关联、公式脏行 — 见 [`VERIFY-M12-followups.md`](design-refs/wecom/smart-table/VERIFY-M12-followups.md)
- 企微截图索引：`docs/design-refs/wecom/SCREENSHOT-INDEX.md`
