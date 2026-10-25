/** 表格页内：向已有 Base 追加工作表 / 表单 / 仪表盘 / 分析报告 */

export type ObjectTemplateKind = 'sheet' | 'form' | 'dashboard' | 'report';

export interface ObjectTemplateField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

export interface ObjectTemplateDefinition {
  key: string;
  name: string;
  kind: ObjectTemplateKind;
  icon: string;
  description: string;
  /** sheet / form */
  fields?: ObjectTemplateField[];
  records?: Array<Record<string, unknown>>;
  /** form 默认成功页文案 */
  successTemplate?: string;
}

export const OBJECT_KIND_LABEL: Record<ObjectTemplateKind, string> = {
  sheet: '工作表',
  form: '收集表单',
  dashboard: '仪表盘',
  report: '分析报告',
};

export const OBJECT_TEMPLATE_CATALOG: ObjectTemplateDefinition[] = [
  {
    key: 'obj-sheet-customers',
    name: '客户跟进',
    kind: 'sheet',
    icon: '🤝',
    description: '客户名称、联系人、阶段与预计金额，适合销售跟进。',
    fields: [
      { name: '客户名称', type: 'text', required: true },
      { name: '联系人', type: 'text' },
      { name: '手机号', type: 'phone' },
      {
        name: '阶段',
        type: 'select',
        options: {
          choices: [
            { id: 'lead', name: '线索', color: 'gray' },
            { id: 'active', name: '跟进中', color: 'blue' },
            { id: 'won', name: '已成交', color: 'green' },
          ],
        },
      },
      { name: '预计金额', type: 'currency' },
    ],
    records: [
      {
        客户名称: '晨光科技',
        联系人: '王经理',
        阶段: 'active',
        预计金额: 120000,
      },
      {
        客户名称: '云帆供应链',
        联系人: '李总',
        阶段: 'lead',
        预计金额: 80000,
      },
    ],
  },
  {
    key: 'obj-sheet-tasks',
    name: '项目任务',
    kind: 'sheet',
    icon: '🗂️',
    description: '任务、负责人、优先级与截止日期。',
    fields: [
      { name: '任务', type: 'text', required: true },
      { name: '负责人', type: 'text' },
      {
        name: '优先级',
        type: 'select',
        options: {
          choices: [
            { id: 'p0', name: 'P0', color: 'red' },
            { id: 'p1', name: 'P1', color: 'yellow' },
            { id: 'p2', name: 'P2', color: 'gray' },
          ],
        },
      },
      { name: '截止日期', type: 'date' },
      { name: '完成', type: 'checkbox' },
    ],
    records: [
      { 任务: '需求评审', 优先级: 'p0', 完成: false },
      { 任务: '开发联调', 优先级: 'p1', 完成: false },
    ],
  },
  {
    key: 'obj-form-signup',
    name: '活动报名',
    kind: 'form',
    icon: '📝',
    description: '姓名、手机号、备注，适合活动报名收集。',
    fields: [
      { name: '姓名', type: 'text', required: true },
      { name: '手机号', type: 'phone', required: true },
      { name: '备注', type: 'text' },
    ],
    successTemplate: '报名成功，我们会尽快与你联系。',
  },
  {
    key: 'obj-form-feedback',
    name: '意见反馈',
    kind: 'form',
    icon: '💬',
    description: '反馈类型、内容与联系方式。',
    fields: [
      {
        name: '类型',
        type: 'select',
        required: true,
        options: {
          choices: [
            { id: 'bug', name: '问题反馈', color: 'red' },
            { id: 'idea', name: '产品建议', color: 'blue' },
            { id: 'other', name: '其他', color: 'gray' },
          ],
        },
      },
      { name: '内容', type: 'text', required: true },
      { name: '联系方式', type: 'text' },
    ],
    successTemplate: '感谢反馈，我们已收到。',
  },
  {
    key: 'obj-dashboard-overview',
    name: '数据概览',
    kind: 'dashboard',
    icon: '📊',
    description: '空白仪表盘，可自行添加图表与定时推送。',
  },
  {
    key: 'obj-dashboard-ops',
    name: '运营看板',
    kind: 'dashboard',
    icon: '📈',
    description: '面向运营指标的空白看板。',
  },
  {
    key: 'obj-report-business',
    name: '经营分析',
    kind: 'report',
    icon: '📑',
    description: '用 AI 对话生成经营分析报告。',
  },
  {
    key: 'obj-report-weekly',
    name: '周报总结',
    kind: 'report',
    icon: '🗓️',
    description: '用 AI 对话生成周报类分析。',
  },
];
