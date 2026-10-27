# VERIFY-M2：网格 Canvas 渲染与编辑

## 1. 企微证据

[`HAR-TECH-ANALYSIS.md`](./HAR-TECH-ANALYSIS.md) §14：`WordMeasurer` + `BreakLine` + `appendEllipsis`（grapheme 二分）；§8.4 打开阶段 `opendoc`→首屏→EDITABLE；灰度 `DB_CHUNK_NEW_RENDER`。截图 `10-grid-table/`。编辑器壳在 `5347.*`（浮层 textarea）。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| 主网格 1× canvas | `grid-canvas/engine.ts` + `CanvasGrid` | **对齐** |
| 行虚拟化 / overscan | `UniformAxis` + `computeVisibleRange` | **对齐** |
| 冻结列 | `freezeColumnCount` | **对齐** |
| 列宽拖拽持久化 | `field.options.width` | **对齐** |
| breakLine 多行 | 单元格单行+clip；行高 short/medium/tall | **部分对齐**（多行折行弱） |
| appendEllipsis | `truncateToWidth` 二分前缀+… | **已修对齐** |
| 测宽词缓存 | `measureCache` font→word→width | **已修对齐** |
| 编辑浮层 | CanvasGrid 内联 editor | **对齐交互** |
| chunk 本地 DB | 无；REST 块对齐窗口 + 方向预取 + skeleton（`sync/record-window.ts`） | **架构差但行窗口语义对齐**；本地 DB 仍待定 |

## 3. 偏差

1. ~~纯 `fillText` 无省略~~ → **已修** `truncateToWidth`。  
2. ~~测宽无缓存~~ → **已修** `measureCached`。  
3. 多行 `breakLine` / CHAR_WRAP：未做完整折行引擎 → 弱差。  
4. 公式：企微服务端 `formulaResZip`；我方查询后 `evaluateFormulaRows` → 架构差，标知悉。

## 4. 性能

行虚拟化 + 裁剪绘制与企微同阶；缺词宽缓存时超长重复串略差。不做 chunk DB。

## 5. 结论

主路径 Canvas 对齐；省略已补。→ M3。
