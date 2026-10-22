# VERIFY-M6：自动化全动作面

加深 [VERIFY-01-automation-claim.md](./VERIFY-01-automation-claim.md)。

## 1. 企微证据

sdk_1 `R.X2`：`LOOKUP=1 INSERT=2 UPDATE=3 SEND_MESSAGE=4 CREATE_GROUP=5 ADD_GROUP_MEMBER=6 SEND_HTTP=7`。HAR「联动修改」实帧。截图 `04-automation/`。

## 2. 我方映射

| 企微 X2 | 我方 step | 状态 |
|---------|-----------|------|
| LOOKUP_RECORD | `findRecords` + SKIP LOCKED | **对齐且更强** |
| INSERT_RECORD | `createRecord` | **对齐** |
| UPDATE_RECORD | `modifyRecords` fromStep/ids/filters | **对齐** |
| SEND_MESSAGE | `sendMessage` | **对齐** |
| CREATE_GROUP | `startGroupChat` | **对齐**（Local fallback） |
| ADD_GROUP_MEMBER | `addGroupMembers` | **对齐** |
| SEND_HTTP | `sendHttp`（method/url/headers/body/timeout） | **已修骨架** |
| 触发 insert/update | recordCreated/Updated | **对齐** |
| record_timer | — | 见 M7 |

## 3. 偏差

1. ~~**SEND_HTTP**~~ → **已修**：shared 类型 + runner `fetch` + 编辑器「发送HTTP请求」；非 2xx/超时失败步骤；无 SSRF 私网黑名单（知悉）。  
2. 填写者：可选 Bearer；匿名回落 admin → 产品边界已文档化。

## 4. 性能

`baseId` 扫描、字段缓存、claim_status+SKIP LOCKED：领取热路径优于朴素 SELECT。

## 5. 结论

除 HTTP 与 timer 外动作面对齐。→ M7。
