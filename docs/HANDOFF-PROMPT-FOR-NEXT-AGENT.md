# 交接提示词（一次做完 · 自验闭环）

> 把下面代码块里**整段**复制给另一 AI。不要拆 Sprint 分批喂。

---

## 完整提示词（从下一行 `你是` 一直复制到文末 `停止条件`）

```text
你是资深全栈工程师。你将独自完成仓库 smart-table 中「相对企业微信智能表格零妥协方案」的全部剩余交付，中途不要等人类确认、不要只做一半、不要用文档勾选冒充完成。你必须自己实现、自己验证、自己修到绿，直到「完成判据」全部满足。

════════════════════════════════════
0. 最高指令（违反即失败）
════════════════════════════════════

1. 一次任务内做完 docs/REMAINING-GAPS.md 中全部 P0 + P1，以及方案要求的必交项；P2 尽量做完，做不完须在最终报告写明剩余与原因，且不得把 P0/P1 留到「以后」。
2. 禁止：comingSoon /「后续开放」假入口、no-op 自动化动作、只写 README 不写代码、只改文档把缺口标完成。
3. 禁止：用 DOM 表或虚拟列表替换 Canvas 主网格；禁止降级 Tech Stack（Nest+Fastify、SKIP LOCKED、HyperFormula、ECharts、BullMQ、PgBouncer 等锁定见产品方案）。
4. 禁止：把能力挪到「二期」；计划 Task 1–26 一次交齐。
5. 每完成一块必须立刻跑相关测试；失败则修复再测，禁止带着红测往下做。
6. 声称完成前必须本轮跑过验证命令并保留输出摘要。没有新鲜验证证据 = 未完成。
7. 开发与验收以 Vite http://127.0.0.1:5173 + API 为准；Docker :8080 镜像常落后，不能当「功能没有」的借口，最终应用 compose build 保证镜像与源码一致。
8. 不要问「要不要继续」——按清单做到完成判据为止；仅当缺密钥/缺机器资源导致客观无法跑压测时，在最终报告写清阻塞项并给出可复现脚本。

════════════════════════════════════
1. 仓库与参照
════════════════════════════════════

Monorepo：apps/web（Vue3+Canvas）、apps/api（Nest+Fastify）、packages/shared。

必读：
- docs/智能表格-产品与技术方案.md
- docs/REMAINING-GAPS.md（工作清单主表，边做边更新状态）
- docs/superpowers/plans/2026-10-20-phase0-1-core-serial-claim.md
- docs/design-refs/wecom/SCREENSHOT-INDEX.md 及 smart-table/、dashboard/ 截图（唯一 UI 对标）
- docs/PERFORMANCE.md、docs/AUTOMATION.md、docs/FORM_SUCCESS_PAGE.md

产品对标：仅企业微信智能表格 + 仪表盘。
不做：CRDT 实时多人、可编辑公网外链、多区域多活、短信验证码、飞书/Airtable 对标。

════════════════════════════════════
2. 现状（勿重复造轮子）
════════════════════════════════════

已有基础：密码登录、企微 OAuth 源码、Workspace/Base/Sheet/Record、Canvas 多层虚拟化、行号、字段类型选择器、列头改名改类型、基础类型单元格编辑、筛选分组排序行高填色（简陋）、表单公开提交+成功页变量+二维码+序列号占码 SKIP LOCKED、自动化 runner+日志、ACL、仪表盘 ECharts+定时推送、文件夹模板、共享/公开只读、OpenAPI/Webhook、配额审计、同步、队列/索引、OTel/K8s 骨架、perf 脚本。

未完成重点：企微级表单构建器、自动化可视化编辑、表格高级交互（列宽持久化/删字段/选项编辑器/更多字段编辑）、命名视图、schedule 自动化 runner、群聊真适配、顶栏分享/更多、成员邀请 UI、Task26 压测报告、ClickHouse ETL、镜像与源码一致。

════════════════════════════════════
3. 你必须交付的全部工作包（按序，但全部做完）
════════════════════════════════════

### W1 — 表格（对齐企微截图 10-grid-table / 01-field-types）
- 列宽拖拽持久化到 field.options，刷新不丢
- 删除字段 API+UI（确认）；补齐 rename/delete sheet 若缺失
- 单选/多选选项编辑器（增删改、颜色）
- 筛选/分组/排序/填色浮层交互贴近企微（可多条件）
- 人员字段：可选工作区成员；图片或文件字段：上传+格子展示（至少一种完整）
- 冻结列或行多选至少落地一种常用交互
- Playwright 覆盖：加字段→改选项→改列宽刷新仍在→删字段→类型编辑

### W2 — 收集表单构建器（11-form-builder / 成功页 / 分享）
- 可视化编辑：字段加入/移除/排序/必填
- 封面上传 UI
- 显示条件可视化编辑（复用 shared form-display）
- 分享：启用链接、复制、二维码、范围/过期若 API 已有则全部露出
- 成功页模板编辑+预览 {{变量}}
- 保护序列号领取 E2E 不被破坏

### W3 — 自动化可视化编辑器（04-automation）
- 创建/编辑/启停（禁止只读）
- 触发 recordCreated/recordUpdated + 条件
- 步骤：findRecords(limit 默认1)、modifyRecords(可绑上一步)、createRecord、sendMessage；群聊步骤 UI 可用（后端无凭证可 Local，但要真实写入可测路径）
- 步骤变量插入菜单
- 运行日志详情
- 配置出的 JSON 必须能跑通现有领码链路

### W4 — 平台补齐
- 命名视图：Prisma 模型 + CRUD + 侧栏切换（持久化 filter/sort/group/rowHeight/colorRules）
- 自动化 schedule：真实定时 runner（不是只校验类型）
- 顶栏「分享」接到真实能力；「更多」做出有内容的菜单或拆掉假入口
- 成员邀请 UI
- 企微群聊：有凭证走真 API，无凭证 Local，并更新 .env.example
- 仪表盘布局至少达到「多图可用画布」，不要简陋单列凑合到无法对照截图

### W5 — 性能与交付闭环
- 跑并固化 Task26：更新 docs/PERFORMANCE.md（并发领码、窗口拉取、网格 perf；写明机器与命令；数字必须本环境跑出）
- scripts/perf 与 pnpm scripts 可复现
- docker compose build api web claim-worker 并 smoke：health、公开表单提交或 /health+/metrics
- ClickHouse：若不做满 ETL，须在 REMAINING-GAPS 标明「查询适配器有、ETL 未做」且不影响默认 PG 路径；优先实现最小可用同步或明确文档+compose profile

### W6 — 收尾
- 更新 docs/REMAINING-GAPS.md：P0/P1 全部标完成或仅剩客观阻塞
- 最终报告：做了什么、验证命令与结果、已知限制、如何启动

════════════════════════════════════
4. 自驱动工作循环（强制）
════════════════════════════════════

对每个工作包 W1…W6：
  a. 读相关截图与现有代码
  b. 实现（前后端一起，缺 API 先补 API）
  c. 写/更新测试
  d. 跑测试；失败则修，直到绿
  e. 手测或 Playwright 关键路径
  f. 更新 REMAINING-GAPS.md 对应行
  g. 进入下一包，不要停下来问人类

推荐验证命令（按改动选用，完成前尽量全跑关键集）：
- pnpm --filter shared test
- pnpm --filter web exec vitest run
- pnpm --filter api test:e2e --runInBand
- pnpm --filter web exec playwright test
- pnpm perf:claim / perf:grid / perf:window / perf:form（环境允许时）
- 手测：5173 登录 → 模板序列号 → 填表出码 → 自动化运行成功

════════════════════════════════════
5. 完成判据（全部满足才能停止）
════════════════════════════════════

[ ] W1–W4 功能在 :5173 可点可用，无 comingSoon 冒充核心能力
[ ] 序列号领取主路径仍通过（API e2e + web e2e）
[ ] 自动化可在 UI 配置并跑通至少一条「查找+修改」
[ ] 表单构建器可配置封面或显示条件或字段排序中至少完整两项，且分享+成功页可用
[ ] 命名视图可保存并切换
[ ] schedule 自动化能实际触发（有测试或可观察运行日志）
[ ] PERFORMANCE.md 有本轮新鲜压测数据与命令
[ ] REMAINING-GAPS.md 已更新；P0/P1 无「未做」
[ ] 最终回复包含：变更摘要、验证证据、剩余客观限制（若有）

未满足任一完成判据 = 继续干，禁止宣布完工。

════════════════════════════════════
6. 工程纪律
════════════════════════════════════

- 复用 packages/shared、现有 Canvas 引擎、endpoints；禁止第二套网格
- 改动聚焦交付；避免无关大重构
- 中文 UI；代码英文标识符
- 用户未要求则不要 git push；若环境已要求提交则按仓库风格写 commit message
- Windows 可能是 PowerShell，注意脚本语法

════════════════════════════════════
7. 现在开始
════════════════════════════════════

立即从 W1 做到 W6 全部完成判据满足为止。自己验证、自己修复、自己更新缺口文档。高质量，对标企微截图。不要等待下一步指令。

停止条件：第 5 节完成判据全部勾选且有验证证据。
```

---

## 给你的一句用法

复制上面代码块全文 → 贴给另一 AI → 说「按提示词执行到停止条件」。  
验收时盯三样：`:5173` 能点、测试绿、`REMAINING-GAPS.md` 里 P0/P1 不再是「未做」。
