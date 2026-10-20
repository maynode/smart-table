# 企业微信 — 参考截图（分类存放）

**逐张解析与查阅：[`SCREENSHOT-INDEX.md`](./SCREENSHOT-INDEX.md)**（24 张已过目入库）。

```
wecom/
├── SCREENSHOT-INDEX.md  ← 完整图鉴备注（后面优先查这个）
├── smart-table/         ← 智能表格
├── dashboard/           ← 仪表盘
└── shared/              ← 共用（模板库等）
```

## 智能表格 `smart-table/`

| 子目录 | 内容 |
|--------|------|
| `01-field-types` | 字段类型菜单 |
| `04-automation` | 表格侧自动化（触发/查找/发消息） |
| `05-permissions` | 内容权限、行/列权限、权限档位 |
| `06-share-public` | 分享收集表单 |
| `10-grid-table` | 码库网格、表格设置 |
| `11-form-builder` | 填写表单预览 |

仍缺：`03-form-success-page`（提交成功页）、表单「编辑表单」页、自动化「修改记录」完整步。

## 仪表盘 `dashboard/`

| 子目录 | 内容 |
|--------|------|
| `02-chart-config` | 图表基础配置 / 更多配置（类型、轴、图例、标签、网格） |
| `03-dashboard-automation` | 定时发送仪表盘、消息内容 |

## 共用 `shared/`

| 子目录 | 内容 |
|--------|------|
| `01-templates` | 模板库（含 AI 工作表模板 + 仪表盘模板；导入 Excel / 我的模板） |

新增截图时：表格相关进 `smart-table/`，图表/仪表盘进 `dashboard/`，两边都出现的入口进 `shared/`。
