# 智能表格截图

工作表、收集表单、表格自动化、内容权限（行/列）等。

**开发原则（本仓库）：** 功能复刻企微网页智能表 + 自有登录 + 可增强；**协同编辑 / 断网离线 / 同步暂缓**（先打磨现有能力至成熟，见 `docs/REMAINING-GAPS.md`）。有疑问先查本目录技术拆解与 `materials/wecom-js`，再写代码。见 `.cursor/rules/wecom-tech-first.mdc`。

技术拆解（网络 + CDN JS，已脱敏结论）：

- [`HAR-TECH-ANALYSIS.md`](./HAR-TECH-ANALYSIS.md)：企微智能表格 Mutation / FieldType / 打开阶段 / MessageCenter / 协同 WS / Canvas 文字排版（§14）

已入库重点：

- `05-permissions/`：全员权限对象列表 → 码库权限 → 记录范围菜单 → 权限档位（全部/可编辑/仅浏览/无）→ 行/列细调  
- `04-automation/`：与**表格/表单**联动的流程（勿与仪表盘定时发送混淆）  
