# 校验①：序列号领取 / 联动修改 — 企微源码对照

> 日期：2026-10-22  
> 证据：`materials/wx-table-all.har` → `POST …/automation/list`（`name: 联动修改`）  
> SDK：`materials/wecom-js/initial_smartsheet_sdk_1.*.js` → `R.X2`  
> 我方：`automation-runner.service.ts`、`serial-claim.seed.ts`、`forms.service.ts#runClaim`

## 1. 企微实包 workflow（HAR 原文结构）

```
trigger type=1 insert_record
  insert_record_trigger_data.not_empty_field_id = 手机号字段
actions:
  LOOKUP  type=1  record_selector.type=2 + filter(状态=未领 choice)  action_type=1
  UPDATE  type=3  record_selector.type=3 step_id=LOOKUP
                  values: 状态=已领(literal) + 手机号=ref trigger
  SEND    type=4  send_message_action_data.type=2 (文档消息)
                  users = ref trigger.填写者
                  title = text「你的序列号为」
                  content = ref UPDATE.序列号
```

SDK `X2`：`LOOKUP_RECORD=1` `INSERT_RECORD=2` `UPDATE_RECORD=3` `SEND_MESSAGE=4` `CREATE_GROUP=5` `ADD_GROUP_MEMBER=6` `SEND_HTTP=7`。

值块：`value_type` 1=纯文本 / 2=字面 cell(base64) / 3=`ref_step`。  
LOOKUP 过滤 conjunction=`2`(OR 枚举位，本例单条件)；operator=`1`≈等于；单选 cell 为 choice id。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| LOOKUP + filter + action_type≈取码 | `findRecords` limit=1 + SQL filter + 下游 modify 时 `FOR UPDATE SKIP LOCKED` | **对齐且更强**（并发占码） |
| 空结果停 | `onEmpty` / `onFindEmpty: stop`；表单 `skipped`→「序列号已领取完毕」 | **对齐** |
| UPDATE selector.type=3 | `target: { mode: 'fromStep', stepId }` | **对齐** |
| 写状态+触发手机号 | seed 写状态/领取手机号；另写领取时间=`now` | **对齐 + 扩展** |
| SEND title/content 拆分 | seed `name=你的序列号为` + `text={{第3步.序列号}}` | **对齐** |
| users←填写者 | recipients `trigger.填写者`；公开填表可选 Bearer→`submitterUserId`；匿名回落 owner/admin | **能力对齐**（匿名无企微系统人员字段） |
| 成功页出码 | `runClaim` 同事务 + 模板 `{{序列号}}` | **强于企微** |
| pad 范围 list | trigger 扫描 `baseId` 过滤 | **已对齐** |
| update 字段元数据一次 | `modifyRecords` per-sheet 字段缓存 | **已对齐** |

## 3. 性能

| 项 | 企微 | 我方 |
|----|------|------|
| 占码 | 服务端执行（HAR 无 SQL） | `claim_status` + `SKIP LOCKED` |
| 触发扫描 | pad 维度 | `baseId` 过滤 |
| 改多行字段加载 | 一次 mapping | per-sheet 缓存 |

## 4. 客观差（不假装）

- 企微系统字段「填写者」；我方公开表单以手机号为主，登录用户才有稳定 userId。
- `SEND_HTTP` / 到达记录时间触发未做。
- 协同 Mutation/WS 不在本校验范围。

## 5. 结论

领取主链路相对企微 **LOOKUP→UPDATE→SEND** 语义已对齐；并发占码与成功页直出为相对优势。→ 校验②。
