/**
 * Field types mirror the WeCom smart-table field menu
 * (docs/design-refs/wecom/smart-table/01-field-types/01 + 02), plus the AI entry.
 * The union is intentionally complete: expression/computed types are modeled here
 * even though evaluation lands in Task 16 (HyperFormula).
 */
export const FIELD_TYPES = [
  'text',
  'longText',
  'title',
  'select',
  'multiSelect',
  'number',
  'percent',
  'currency',
  'progress',
  'date',
  'person',
  'groupChat',
  'image',
  'file',
  'relation',
  'url',
  'phone',
  'email',
  'location',
  'checkbox',
  'barcode',
  'autoNumber',
  'formula',
  'lookup',
  'createdBy',
  'lastEditedBy',
  'createdAt',
  'lastEditedAt',
  'ai',
  'aiComponent',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  longText: '多行文本',
  title: '标题',
  select: '单选',
  multiSelect: '多选',
  number: '数字',
  percent: '百分数',
  currency: '货币',
  progress: '进度',
  date: '日期',
  person: '人员',
  groupChat: '群聊',
  image: '图片',
  file: '文件',
  relation: '关联',
  url: '链接',
  phone: '电话',
  email: '邮箱',
  location: '地理位置',
  checkbox: '复选框',
  barcode: '条码',
  autoNumber: '自动编号',
  formula: '公式',
  lookup: '查找引用',
  createdBy: '创建人',
  lastEditedBy: '最后编辑人',
  createdAt: '创建时间',
  lastEditedAt: '最后编辑时间',
  ai: 'AI 字段',
  aiComponent: '智能组件',
};

/** Fields maintained by the system, not typed in by users. */
export const SYSTEM_FIELD_TYPES: readonly FieldType[] = [
  'createdBy',
  'lastEditedBy',
  'createdAt',
  'lastEditedAt',
];

/** Fields whose value is computed rather than stored directly by the client. */
export const COMPUTED_FIELD_TYPES: readonly FieldType[] = [
  'formula',
  'lookup',
  'autoNumber',
  'ai',
];

/** Fields rendered as a choice pill / tag. */
export const CHOICE_FIELD_TYPES: readonly FieldType[] = ['select', 'multiSelect'];

/** Fields backed by object storage (MinIO or the filesystem emulation). */
export const ATTACHMENT_FIELD_TYPES: readonly FieldType[] = ['image', 'file'];

export const NUMERIC_FIELD_TYPES: readonly FieldType[] = [
  'number',
  'percent',
  'currency',
  'progress',
];

export function isSystemFieldType(type: FieldType): boolean {
  return SYSTEM_FIELD_TYPES.includes(type);
}

export function isComputedFieldType(type: FieldType): boolean {
  return COMPUTED_FIELD_TYPES.includes(type);
}

export function isChoiceFieldType(type: FieldType): boolean {
  return CHOICE_FIELD_TYPES.includes(type);
}

/**
 * Types that must not appear as fillable form questions
 * (computed / system-maintained). Match grid: users don't type these.
 */
export const FORM_NON_FILLABLE_FIELD_TYPES: readonly FieldType[] = [
  ...SYSTEM_FIELD_TYPES,
  ...COMPUTED_FIELD_TYPES,
  'aiComponent',
];

export function isFormFillableFieldType(type: string): boolean {
  return !(FORM_NON_FILLABLE_FIELD_TYPES as readonly string[]).includes(type);
}

export interface FieldOption {
  id: string;
  name: string;
  color?: string;
}

export interface LookupOptions {
  /** Relation field on the same sheet that points at the target sheet. */
  relationFieldId: string;
  /** Field on the related sheet whose value is pulled in. */
  targetFieldId: string;
  /** Aggregate when the relation holds multiple records. */
  aggregate?: 'first' | 'count' | 'sum' | 'min' | 'max' | 'array';
}

export interface RelationOptions {
  targetSheetId: string;
  multiple?: boolean;
  /** Field of the target sheet shown in the cell. */
  displayFieldId?: string;
  /**
   * When true, writing this cell also updates the paired reverse relation
   * on the target sheet (`reverseFieldId`). WeCom TWO_WAY_LINK semantics.
   */
  bidirectional?: boolean;
  /** Relation field id on the target sheet that points back here. */
  reverseFieldId?: string;
}

export interface AutoNumberOptions {
  prefix?: string;
  padding?: number;
  start?: number;
  scope?: 'sheet' | 'base';
  /** Next integer to assign; advanced atomically on each new record. */
  next?: number;
}

export interface AiFieldOptions {
  /** Configurable provider; without a key the field type still exists. */
  provider?: string;
  model?: string;
  prompt?: string;
  sourceFieldIds?: string[];
}

export type {
  AiComponentBridgeManifest,
  AiComponentBundle,
  AiComponentGridContract,
  AiComponentOptions,
} from './ai-component-contract';

export interface FieldOptions {
  choices?: FieldOption[];
  precision?: number;
  currency?: string;
  dateFormat?: string;
  includeTime?: boolean;
  /** WeCom `mobilePhotoOnly` / 仅限手机拍照上传 — image fields only. */
  mobilePhotoOnly?: boolean;
  formula?: string;
  lookup?: LookupOptions;
  relation?: RelationOptions;
  autoNumber?: AutoNumberOptions;
  ai?: AiFieldOptions;
  /** 对话生成的可交互沙箱组件（与填值型 `ai` 分开） */
  aiComponent?: import('./ai-component-contract').AiComponentOptions;
  min?: number;
  max?: number;
  [key: string]: unknown;
}

export interface FieldDefinition {
  id: string;
  sheetId: string;
  name: string;
  type: FieldType;
  order?: number;
  required?: boolean;
  hidden?: boolean;
  description?: string;
  options?: FieldOptions;
}
