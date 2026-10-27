# 交接提示词（协同观感主线）

> 把下面代码块整段复制给下一任 AI。功能主路径 / P0 / PWA 离线已齐，**不要再扫造功能**。

当前仓库分支：`main`。PWA 相关提交：`558eb11`。事实清单：`docs/REMAINING-GAPS.md`。

---

```text
你是资深全栈工程师。仓库 smart-table 相对企微网页版智能表格：主能力与 P0 交付、PWA/chunk 本地库已落地。
你的唯一主线是「实时协同观感」，不是新功能盘。

════════════════════════════════════
0. 最高指令
════════════════════════════════════
1. 先读 docs/REMAINING-GAPS.md §0 / §2「当前唯一主线」与 docs/COLLAB.md §9。
2. 禁止再扫造功能、禁止像素级企微 UI 孪生、禁止企微登录/真通讯录/真企微群（待定）。
3. 禁止用「先广播 JSON 不做 transform」冒充最严协同；OT 路径已有，只打磨体验。
4. 改协同后必须跑相关回归；崩溃安全/幂等/多 Tab 按仓库 strict-engineering。
5. 技术材料：HAR-TECH-ANALYSIS §8/§12、materials/live-ws-user-changes.redacted.json、
   materials/wecom-ot-transforms.extracted.json；协议自洽即可，不要求 Engine.IO 孪生。

════════════════════════════════════
1. 已完成（勿重做）
════════════════════════════════════
- W1–W4、M12、UI 打磨、P0 e2e/压测/compose、仪表盘 AI Agent、Live Bus、离线 MessageCenter
- PWA 壳 + chunk 本地库 + object-outbox + offline-capability（docs/OFFLINE.md §0）
- 协同协议：Nest /collab + sheet_rev + OT + 单元格短租约（docs/COLLAB.md）

════════════════════════════════════
2. 你要做的（协同观感）
════════════════════════════════════
1. 双人同编流畅度：延迟、accept 回执、远端 new_changes 上屏节奏
2. 冲突/锁提示：短租约失败、COMMIT_VERSION_CONFLICT 文案与恢复
3. 光标/在线叠层：少遮挡、可扫读
4. 回归：相关 API/Playwright；离线 flush 路径不得静默降级
5. 可选：起 API:3000 + web:5173 后跑 e2e/offline-sync.spec.ts（含 cold reload）坐实 PWA
6. 更新 REMAINING-GAPS / COLLAB §9；未满足收工门槛不得宣称「协同体验完成」

════════════════════════════════════
3. 停止条件
════════════════════════════════════
- 双浏览器无刷新互见且观感可接受（延迟/冲突/锁有明确产品态）
- 相关测试绿；文档已改「#3 协同观感」状态
- 未引入新功能盘或企微强绑定
```
