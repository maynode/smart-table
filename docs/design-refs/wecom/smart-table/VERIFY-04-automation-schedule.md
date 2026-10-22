# 校验④：自动化 schedule 原子抢占 — 企微源码对照

> 日期：2026-10-22  
> 证据：HAR `automation/list` → `record_timer_limit` / `next_reminder_ts`；`workflow` 上 `record_timer_ext_info`  
> SDK request-map / automation list 解析痕迹  
> 我方：`automation-scheduler.service.ts`、`shared` `nextCronDate`、`automations.service` schedule trigger

## 1. 企微侧

- 自动化配额字段：`workflow_limit` / `action_limit` / **`record_timer_limit`**（本样本 100）。
- 工作流元数据含 `next_reminder_ts` / `cur_reminder_ts` —— 对应 **到达记录时间**（record timer）类触发，由服务端提醒调度，非浏览器 cron。
- 插入触发 `trigger.type=1` 已在校验①对照；timer 为另一触发族。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| record timer（到达时间） | 未实现（产品可后续加） | **缺口标未知** |
| 定时类能力 | `trigger.type=schedule` + cron + timezone | **能力等价表达**（自洽协议） |
| 服务端单次执行 | 15s 轮询 + `updateMany` where `id+enabled+nextRunAt` 原子抢占后推 `nextRunAt` | **多副本安全**（企微云端同理） |
| 执行引擎复用 | 与 record 触发同一 `runAutomation` | **对齐** |
| 配额 | `quotas.assertAutomationRun` | **对齐意图** |

原子抢占关键代码：

```94:102:apps/api/src/automations/automation-scheduler.service.ts
        const claimed = await this.prisma.automation.updateMany({
          where: {
            id: automation.id,
            enabled: true,
            nextRunAt: automation.nextRunAt,
          },
          data: { nextRunAt: next, lastRunAt: new Date() },
        });
        if (claimed.count === 0) continue;
```

## 3. 性能

- 轮询 15s：本地/小规模足够；企微为云端推送/提醒队列，精度通常更高。
- `ticking` 防重入 + claim 100：避免单进程堆积。

## 4. 结论

cron schedule 的**原子抢占与执行复用**正确且适合多副本；企微 **record_timer** 未孪生——记为已知缺口，不阻塞领取/记录触发主路径。→ 校验⑤。
