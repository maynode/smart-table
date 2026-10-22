# VERIFY-M4：记录读写与乐观锁

## 1. 企微证据

HAR-TECH：在线写 = WS `USER_CHANGES` → `ACCEPT_COMMIT`（`base_rev`→`new_rev`）；HTTP `commitchanges` 离线回退。错误码 `SOCKET_COMMIT_VERSION_BREAK`。**产品暂缓协同**，只对照冲突语义。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| base_rev / new_rev | `records.version` + `expectedVersion` | **语义对齐** |
| 冲突拒绝 | `updateMany` where version；409「记录已被他人修改」 | **对齐** |
| 客户端始终带 rev | `BaseShellView` PATCH 传 `payload.record.version` | **对齐** |
| WS 广播他人变更 | 不做 | **暂缓** |

## 3. 偏差

无主路径偏差。多人同时编辑无实时合并 → 产品边界。

## 4. 性能

单行条件更新；无全表锁。优于无版本的裸 update。

## 5. 结论

REST 乐观锁可替代协同 rev 的冲突面。→ M5。
