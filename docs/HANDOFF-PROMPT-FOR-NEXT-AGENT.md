# 交接提示词（W5–W6 收尾 · 自验闭环）

> 把下面代码块里**整段**复制给另一个 AI。W1–W4 已实现并有测试证据，不要重做；它只需要完成 W5–W6 的交付闭环，并修复回归。
>
> 当前仓库：`C:\my-project\smart-table`，分支 `main`。最新功能提交：`8762c66 feat: deliver W1-W4 enterprise parity features`。

---

## 完整提示词（从下一行 `你是` 一直复制到文末 `停止条件`）

```text
你是资深全栈工程师。你将独自完成仓库 smart-table 中「相对企业微信智能表格零妥协方案」的 W5–W6 收尾。W1–W4 已由上一任实现并通过关键路径测试，不要推倒重做，也不要重复造一套网格/表单/自动化。你必须自己验证、自己修复、自己更新文档，直到「完成判据」全部满足。

════════════════════════════════════
0. 最高指令（违反即失败）
════════════════════════════════════

1. 先读仓库，再动手：docs/REMAINING-GAPS.md 是唯一事实清单；以代码和可复现测试为准，不以旧文档勾选为准。
2. 禁止：comingSoon /「后续开放」假入口、no-op 自动化动作、只改 README 不写代码、只改文档把缺口标完成。
3. 禁止：用 DOM 表或虚拟列表替换 Canvas 主网格；禁止降级技术栈（Nest+Fastify、SKIP LOCKED、HyperFormula、ECharts、BullMQ、PgBouncer 等）。
4. 禁止：把剩余工作推到「二期」；禁止只交一半再问人类。
5. 每完成一块立刻跑相关测试；失败则修到绿再往下，禁止带红测继续。
6. 声称完成前必须本轮跑过验证命令并保留输出摘要；没有新鲜证据 = 未完成。
7. 验收以 Vite http://127.0.0.1:5173 + API :3000 为准；Docker :8080 旧镜像不能当功能缺失的借口，但最终必须 compose build 让镜像与源码一致。
8. 不要问「要不要继续」；只有缺密钥/缺机器资源导致客观无法运行时，才在最终报告写清阻塞项和可复现脚本。

════════════════════════════════════
1. 现状：W1–W4 已完成（勿重复实现）
════════════════════════════════════

已有且已有测试证据：
- W1 表格：Canvas 多层网格保持；列宽拖拽持久化到 field.options.width；字段删除；工作表重命名/删除；单选/多选选项编辑器；多条件筛选/多排序/多分组/多填色规则；人员选择；图片/文件上传与格子展示；行多选+批量删除；命名视图保存/切换；条件填色/行高。
- W2 表单：可视化字段增删/排序/必填；封面上传+预览；显示条件可视化（公开表单按作答值动态显示）；分享启用/复制/二维码/范围/过期；成功页模板+变量+预览；序列号领取主路径未破坏。
- W3 自动化：可视化创建/编辑/启停/删除；recordCreated/recordUpdated/schedule 触发+条件；findRecords(limit 默认1)/modifyRecords(绑定上一步)/createRecord/sendMessage/startGroupChat/addGroupMembers；步骤变量插入；运行日志详情；UI 生成的 JSON 已真实跑通「查找→改状态→发消息」领取链路。
- W4 平台：命名视图 Prisma+CRUD+侧栏；schedule 真实 runner（15s 轮询 + nextRunAt 原子 claim）；顶栏「分享」真实面板；「更多」真实菜单；成员邀请/改角色/移除；企微群聊真 API/Local fallback；仪表盘 12 列多图拖拽/缩放/删除、定时推送立即执行。

关键文件：
- 后端：apps/api/src/{sheets,views,forms,automations,dashboards,notify,storage}
- 前端：apps/web/src/components/{GridPanel,CanvasGrid,FieldOptionsEditor,FormBuilderPanel,AutomationEditor,AutomationPanel,DashboardPanel,MembersPanel,SharePanel}.vue
- 共享：packages/shared/src/{cron.ts,form-display.ts,index.ts}
- 测试：apps/api/test/w4-platform.e2e-spec.ts；apps/web/e2e/{grid-w1,form-builder-w2,automation-w3,platform-w4,grid-canvas,serial-claim}.spec.ts

已通过的本轮证据（详见 docs/REMAINING-GAPS.md 第 3 节）：
- shared cron 18/18
- api build 通过
- w4-platform API e2e 5/5
- grid-canvas 2/2、grid-w1 2/2、form-builder-w2 1/1、automation-w3 1/1、platform-w4 1/1、serial-claim 1/1
- 全量 Playwright 9/9（45.1s，含 grid-perf 10M 行 p95 17.8ms）
- web vue-tsc 通过；web vitest 8/8

════════════════════════════════════
2. 你还必须完成的全部工作（W5–W6）
════════════════════════════════════

### W5-A 全量回归（先做）
- pnpm --filter shared test
- pnpm --filter web exec vitest run
- pnpm --filter web exec vue-tsc --noEmit -p tsconfig.json
- pnpm --filter api test:e2e --runInBand
- pnpm --filter web exec playwright test（必须包含 grid-perf.spec.ts）
- 若 wecom-oauth.e2e-spec.ts 再出现邮箱时间戳不一致，定位是共享 mock 状态/测试隔离问题还是真 bug，修到稳定；不要简单 skip。
- 回归中任何 W1–W4 用例变红，修代码/测试，不得回退功能。

### W5-B Task 26 性能报告
- 本机依次跑：pnpm perf:claim、pnpm perf:grid、pnpm perf:window、pnpm perf:form。
- 更新 docs/PERFORMANCE.md：写明机器、Node/DB/Redis 版本、命令、并发/数据量、原始结果、结论、失败项。
- 数字必须是本轮本环境跑出；不得复制旧报告。
- 如果脚本本身不可复现，先修 scripts/perf 和 pnpm scripts，再跑。

### W5-C Docker 交付与 smoke
- docker compose build api web claim-worker
- docker compose up -d（注意本机 PgBouncer 6432、Redis 6380、API 3000 的端口冲突；必要时先停本机 dev API，但不要删数据卷）
- smoke：/health、/metrics、公开表单提交、自动化运行、附件上传。
- 验证容器内代码与源码一致：容器镜像跑出的 /health 版本/新路由与仓库一致；不得让 :8080 继续跑旧镜像。

### W5-D ClickHouse（已完成，勿重做）
- PG→CH ETL 已落地：`ClickHouseEtlService`（`ANALYTICS_ADAPTER=clickhouse`）。默认仍走 PG；不必再实现 ETL。
- 若回归发现 ETL 异常，修服务与配置，并更新 docs/REMAINING-GAPS.md / VERIFY-M12。

### W5-E 体验弱差（P0 交付绿之后再做；清单以 REMAINING-GAPS §2 P1 为准）
- 视觉：按 SCREENSHOT-INDEX 逐屏对齐高频交互（非纯像素闸）。
- 排序：补全 option / natural 相对企微的 SQL/应用层语义。
- 仪表盘：加深 NUMBER（metric）卡配置与查询深度。
- 若选 b，不得在 UI 暴露可切换 ClickHouse 的假入口。

### W6 收尾
- 更新 docs/REMAINING-GAPS.md：P0 全部完成或只剩客观阻塞；P1/P2 状态准确。
- 写最终报告（可直接放 docs/FINAL-REPORT.md 并在回复中摘要）：变更摘要、验证命令与结果、剩余客观限制、启动步骤。
- 若最终仍有未完成项，必须逐项写「为什么无法完成 + 复现命令 + 影响范围」，不能笼统写“后续优化”。

════════════════════════════════════
3. 自驱动工作循环（强制）
════════════════════════════════════

对 W5-A→W5-D→W6：
  a. 读 docs/REMAINING-GAPS.md 和对应代码/测试
  b. 实现（缺 API 先补 API，缺测试先补测试）
  c. 跑相关测试；失败修到绿
  d. 手测 5173 关键路径
  e. 更新 REMAINING-GAPS.md 对应行和证据
  f. 进入下一项，不要停下来问人类

常用命令：
- pnpm --filter shared build && pnpm --filter shared test
- pnpm --filter api build
- pnpm --filter api test:e2e --runInBand
- pnpm --filter web exec vue-tsc --noEmit -p tsconfig.json
- pnpm --filter web exec playwright test
- pnpm perf:claim / perf:grid / perf:window / perf:form
- docker compose build api web claim-worker

════════════════════════════════════
4. 完成判据（全部满足才能停止）
════════════════════════════════════

[ ] 全量 API e2e 绿（含 wecom-oauth；若有 flake，已修隔离或给出稳定化证据）
[ ] 全量 Web Playwright 绿（含 W1–W4 + serial-claim + grid-perf）
[ ] vue-tsc / vitest 绿
[ ] PERFORMANCE.md 有本轮新鲜压测数据、机器信息、命令与结论
[ ] docker compose build api web claim-worker 成功，容器 smoke 通过，镜像与源码一致
[ ] ClickHouse 若未做 ETL，已在 REMAINING-GAPS.md 明确标注且默认 PG 路径不受影响
[ ] REMAINING-GAPS.md 已更新：P0 无「未做」；P1/P2 状态准确
[ ] 最终回复/最终报告包含：变更摘要、验证证据、剩余客观限制、启动步骤

未满足任一完成判据 = 继续干，禁止宣布完工。

════════════════════════════════════
5. 工程纪律
════════════════════════════════════

- 复用 packages/shared、现有 Canvas 引擎、endpoints；禁止第二套网格。
- 改动聚焦交付；避免无关大重构。
- 中文 UI；代码英文标识符。
- Windows PowerShell 语法；长任务用后台 job，不要阻塞等待。
- 不提交 .env、密钥、测试产物、node_modules、.data。
- 用户已要求提交时按仓库风格写 commit message；推送前先确认测试绿。
- 已知环境：本机 Vite 5173 + API 3000 正在跑；Docker API 容器此前被停，属预期；不要因此重启旧镜像掩盖问题。

════════════════════════════════════
6. 现在开始
════════════════════════════════════

从 W5-A 全量回归开始。先读 docs/REMAINING-GAPS.md，再跑命令；失败自己修。完成后更新文档并给出最终报告。不要重复实现 W1–W4，不要等待下一步指令。

停止条件：第 4 节完成判据全部勾选且有本轮新鲜验证证据。
```

---

## 给你的一句用法

复制上面代码块全文 → 贴给另一个 AI → 说「按提示词执行到停止条件」。  
验收时盯三样：`:5173` 能点、全量测试绿、`REMAINING-GAPS.md` 的 P0 不再是「未做」。
