# VERIFY-M1：字段类型与单元格值模型

## 1. 企微证据

来源：[`HAR-TECH-ANALYSIS.md`](./HAR-TECH-ANALYSIS.md) §8.1（`sdk_0`）；HAR 单选 type=17；截图 `01-field-types/`。

| 码 | 企微名 | 码 | 企微名 |
|----|--------|----|--------|
| 1 TEXT | 17 SINGLE_SELECT | 2 NUMBER | 18 LINK_RECORDS |
| 3 CHECKBOX | 19 FORMULA | 4 DATE_TIME | 20 LOOKUP |
| 5 IMAGE | 21 TWO_WAY_LINK | 6 ATTACHMENT | 22 LOCATION |
| 7 USER | 23 USER_C | 8 URL | 24 TITLE |
| 9 MULTIPLE_SELECT | 25 AUTO_NUMBER | 10–13 系统人/时 | 26 CURRENCY |
| 14 PROGRESS | 27 GROUP_B | 15 PHONE | 28 PERCENT |
| 16 EMAIL | 29 BARCODE | | |

单元格：单选等为 typed cell（HAR base64 `type:17` + choice id）；协议可自洽，不必孪生。

## 2. 我方映射

入口：[`packages/shared/src/field-types.ts`](../../../../packages/shared/src/field-types.ts)、`FieldOptionsEditor`、sheets cells JSON。

| 企微 | 我方 | 状态 |
|------|------|------|
| TEXT / TITLE | `text`（TITLE 不单独建类型） | **对齐语义**；TITLE 弱差 |
| NUMBER/PERCENT/CURRENCY/PROGRESS | 同名 | **对齐** |
| SINGLE/MULTI SELECT | `select` / `multiSelect` | **对齐** |
| DATE_TIME | `date` + options.includeTime | **对齐** |
| IMAGE/ATTACHMENT | `image` / `file` | **对齐** |
| USER / USER_C | `person`（USER_C 材料语义不清） | **对齐主类**；USER_C **未知** |
| URL/PHONE/EMAIL/LOCATION/CHECKBOX/BARCODE | 同名 | **对齐** |
| LINK / TWO_WAY_LINK | `relation`（双向同步细节未知） | **主类对齐**；双向 **未知** |
| FORMULA/LOOKUP/AUTO_NUMBER | 同名 | **对齐类型**；公式求值见 M2/公式节 |
| CREATED/MODIFIED USER/TIME | createdBy/At lastEditedBy/At | **对齐** |
| GROUP_B | `groupChat` | **对齐** |
| （无） | `ai` | **产品增强** |

## 3. 偏差

1. **TITLE**：企微独立类型；我方用文本列表达 → 弱差，不强制拆类型。  
2. **USER_C / TWO_WAY_LINK 细节**：材料不足 → **未知**，禁止编造。  
3. ~~`naturalTime` 缺 `now`~~ → **已修**（类型含 `now`，与领取时间戳一致）。

## 4. 性能

字段元数据按 sheet 加载；cells JSONB。无额外偏差。公式：企微服务端算；我方 `evaluateFormulaRows` 查询后算（见 M2/M3），中小表可接受。

## 5. 结论

菜单级类型面与企微对齐；单元格存 JSON 自洽。→ M2。
