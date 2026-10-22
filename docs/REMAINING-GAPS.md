# 智能表格 — 剩余未完成清单（交接版）

> 更新日期：2026-10-22  
> 对照：`docs/智能表格-产品与技术方案.md`、`docs/superpowers/plans/2026-10-20-phase0-1-core-serial-claim.md`  
> 原则：**不以文档勾选代替验证**。本文件只记录「代码状态 + 可复现证据 + 仍缺什么」。

---

## 0. 一句话现状

W1–W4 的代码与关键路径测试已完成：Canvas 主网格高级交互、可视化表单构建器、可视化自动化编辑器、命名视图、真实 schedule runner、成员邀请、顶栏分享/更多、仪表盘多图布局均已落地，并有 Playwright/API E2E 证据。  
**尚未完成的是 W5 交付闭环**：全量回归、Task 26 新鲜压测数据、Docker 镜像重建与 smoke；ClickHouse 仍只有查询适配器，没有 PG→CH ETL。W6 最终报告待写。

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
| 条件填色、行高、冻结列 | 部分 | 多规则填色/行高完成；**冻结列未做**，行多选已覆盖常用场景 |

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

## 2. 还没做（下一 AI 从这里继续）

### P0 交付闭环（必须做，否则不能宣称完工）

1. **全量回归**
   - 跑完整 `pnpm --filter api test:e2e --runInBand`；此前仅剩 `wecom-oauth.e2e-spec.ts` 一次不稳定失败（示例邮箱时间戳不一致，疑似共享 mock 状态），需复跑确认是 flake 还是真 bug。
   - 跑完整 `pnpm --filter web exec playwright test`，必须包含 `grid-perf.spec.ts`。
   - 跑 `pnpm --filter web exec vue-tsc --noEmit -p tsconfig.json` 和 `pnpm --filter web exec vitest run`。
2. **Task 26 性能报告**
   - 在本机跑 `pnpm perf:claim`、`pnpm perf:grid`、`pnpm perf:window`、`pnpm perf:form`。
   - 把机器信息、命令、原始结果、结论写进 `docs/PERFORMANCE.md`；不得沿用旧数字。
3. **Docker 镜像与源码一致**
   - `docker compose build api web claim-worker`，`docker compose up -d`。
   - smoke：`/health`、`/metrics`、公开表单提交、自动化运行。
   - 当前开发环境是 Vite `:5173` + 本机 API `:3000`；`:8080` 仍是旧镜像，不能作为验收依据。
4. **W6 最终报告**
   - 变更摘要、验证命令与结果、客观限制、启动步骤。

### P1 / P2（不阻塞上述 P0，但应记录）

| 项 | 状态 | 说明 |
|----|------|------|
| ClickHouse ETL | 未做 | 只有 `ANALYTICS_ADAPTER=clickhouse` 查询适配器；没有 PG→CH 同步任务。默认 PG 路径不受影响 |
| 冻结列 | 未做 | 行多选已做；列冻结仍缺 |
| 评论 @ 同事 | 未做 | 评论仍是纯文本 |
| natural-language 自动化步骤卡片 | 未做 | 当前是结构化表单编辑器，功能等价但不是截图同款文案卡片 |
| `autoNumber` / `ai` 字段 | 仅类型位 | 无真正自增/模型调用逻辑 |
| OTel / K8s 完整度 | 骨架 | 无完整集群清单/Ingress/有状态组件 |
| 视觉像素级对齐 | 未完成 | 功能可用，未逐屏对照企微截图 |

### 明确不做（产品边界）

- CRDT 实时多人协作、可编辑公网外链、多区域多活、短信验证码、飞书/Airtable 对标。

---

## 3. 本轮新鲜验证结果

| 命令 | 结果 |
|------|------|
| `pnpm --filter shared test` | 18/18 passed（cron parser） |
| `pnpm --filter api build` | passed (`nest build`) |
| `pnpm --filter api exec jest --config ./test/jest-e2e.json --runInBand test/w4-platform.e2e-spec.ts` | 5/5 passed |
| `pnpm --filter web exec playwright test e2e/grid-canvas.spec.ts` | 2/2 passed |
| `pnpm --filter web exec playwright test e2e/grid-w1.spec.ts` | 2/2 passed |
| `pnpm --filter web exec playwright test e2e/form-builder-w2.spec.ts` | 1/1 passed |
| `pnpm --filter web exec playwright test e2e/automation-w3.spec.ts` | 1/1 passed |
| `pnpm --filter web exec playwright test e2e/platform-w4.spec.ts` | 1/1 passed |
| `pnpm --filter web exec playwright test e2e/serial-claim.spec.ts` | 1/1 passed |
| 全量 `pnpm --filter web exec playwright test` | **9/9 passed（45.1s）**，含 grid-perf：1000 万行 p50 16.7ms / p95 17.8ms |
| `pnpm --filter web exec vue-tsc --noEmit -p tsconfig.json` | passed |
| `pnpm --filter web exec vitest run` | 8/8 passed（2 files） |
| 全量 API e2e | 未跑绿；此前 wecom-oauth 一次 flake；见 P0-1 |

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
- 企微截图索引：`docs/design-refs/wecom/SCREENSHOT-INDEX.md`
