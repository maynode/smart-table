# VERIFY-M7：schedule / record_timer

加深 [VERIFY-04-automation-schedule.md](./VERIFY-04-automation-schedule.md)。

## 1. 企微证据

HAR `automation/list`：`record_timer_limit`、`next_reminder_ts` / `cur_reminder_ts`、`record_timer_ext_info`。属服务端「到达记录时间」提醒族，非浏览器 cron。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| record_timer | 未实现 | **缺口 / 未知细节** |
| 定时能力 | `schedule` + cron + timezone | **能力等价表达** |
| 单次执行 | `updateMany` 抢占 nextRunAt | **对齐多副本** |
| 15s 轮询 | `automation-scheduler` | 精度弱于云推送；本地够用 |

## 3. 偏差

record_timer（字段到达时间触发）未做：需独立产品设计（扫描到期记录 vs 企微提醒队列）。**禁止**把 cron 假装成 record_timer。

## 4. 性能

原子抢占正确；`ticking` 防重入。

## 5. 结论

cron 路径合格；timer 单列缺口。→ M8。
