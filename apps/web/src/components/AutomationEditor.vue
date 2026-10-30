<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type {
  AutomationDto,
  FieldDto,
  MemberDto,
  SheetDto,
} from '../api/types';
import { fieldTypeIcon } from '../ui/field-icons';
import { newId } from '../ui/id';

const props = defineProps<{
  baseId: string;
  automation: AutomationDto | null;
}>();
const emit = defineEmits<{
  close: [];
  saved: [automation: AutomationDto];
  'open-runs': [];
}>();

type StepType =
  | 'findRecords'
  | 'createRecord'
  | 'modifyRecords'
  | 'sendMessage'
  | 'sendHttp'
  | 'condition'
  | 'delay';

interface MappingRow {
  fieldId: string;
  mode: 'literal' | 'variable';
  value: string;
  variableSource: 'trigger' | 'step';
  variableField: string;
}

interface UiStep {
  id: string;
  type: StepType;
  name: string;
  sheetId: string;
  limit: number;
  onEmpty: 'continue' | 'stop';
  /** 查找条件行（与触发器 FilterGroup 同形，扁平且/或）. */
  filterRows: Array<{ fieldId: string; operator: string; value: string }>;
  /** Find-step filter conjunction (企微：满足任意/全部条件). */
  filterConjunction: 'and' | 'or';
  fromStepId: string;
  mappings: MappingRow[];
  channel: 'doc';
  text: string;
  recipientMode: 'trigger' | 'fixed';
  recipientField: string;
  userIds: string[];
  memberUserIds: string[];
  memberUserIdsText: string;
  buttons: Array<{ title: string; url: string }>;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  httpUrl: string;
  httpHeadersJson: string;
  httpBody: string;
  httpTimeoutMs: number;
  /** condition：对照触发或某步 */
  conditionSource: 'trigger' | string;
  delaySeconds: number;
}

interface VariableMenuGroup {
  label: string;
  items: Array<{ label: string; token: string }>;
}

const sheets = ref<SheetDto[]>([]);
const members = ref<MemberDto[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const name = ref('');
const enabled = ref(false);
const triggerType = ref<
  | 'recordCreated'
  | 'recordUpdated'
  | 'schedule'
  | 'recordTimer'
  | 'formSubmitted'
  | 'recordButton'
>('recordCreated');
const triggerSheetId = ref('');
const triggerFormId = ref('');
const buttonKey = ref('run');
const buttonLabel = ref('运行');
const triggerFilters = ref<
  Array<{ fieldId: string; operator: string; value: string }>
>([{ fieldId: '', operator: 'equals', value: '' }]);
const triggerConjunction = ref<'and' | 'or'>('and');
const cron = ref('0 9 * * *');
const timezone = ref('Asia/Shanghai');
const timerFieldId = ref('');
const forms = ref<Array<{ id: string; name: string; sheetId: string }>>([]);
const onFindEmpty = ref<'continue' | 'stop'>('continue');
const monthlyQuota = ref<number | null>(null);
const steps = ref<UiStep[]>([]);
const addStepOpen = ref(false);
const variableMenuStepId = ref('');
const variableMenuGroup = ref('');
const emojiMenuStepId = ref('');
const buttonDraft = ref<{ stepId: string; title: string; url: string } | null>(
  null,
);
/** 修改记录「指定内容」弹层所编辑的步骤 id */
const contentEditorStepId = ref('');
/** 查找记录「满足条件」弹层所编辑的步骤 id */
const filterEditorStepId = ref('');
/** 消息正文尾部正在输入的明文（插入变量前会刷入 step.text） */
const messageTailByStep = ref<Record<string, string>>({});

const EMOJIS = ['👍', '🎉', '✅', '❗', '📌', '🔥', '😊', '🙏', '💡', '📎'];

const stepTypes: Array<{
  value: StepType;
  label: string;
  icon: string;
  color: string;
}> = [
  { value: 'sendMessage', label: '发送消息', icon: '💬', color: '#fa8c16' },
  { value: 'createRecord', label: '新增记录', icon: '➕', color: '#52c41a' },
  { value: 'modifyRecords', label: '修改记录', icon: '✏️', color: '#fa8c16' },
  { value: 'findRecords', label: '查找记录', icon: '🔍', color: '#722ed1' },
  { value: 'sendHttp', label: '发送HTTP请求', icon: '🌐', color: '#595959' },
  { value: 'condition', label: '条件判断', icon: '⑂', color: '#13c2c2' },
  { value: 'delay', label: '延迟等待', icon: '⏱', color: '#8c8c8c' },
];

const typeMenuStepId = ref('');

const triggerSheetIdForFields = computed(() => {
  if (triggerType.value === 'formSubmitted') {
    return (
      forms.value.find((item) => item.id === triggerFormId.value)?.sheetId ?? ''
    );
  }
  return triggerSheetId.value;
});
const triggerFields = computed(() =>
  sheetFields(triggerSheetIdForFields.value),
);
const triggerSheet = computed(() =>
  sheets.value.find((sheet) => sheet.id === triggerSheetIdForFields.value),
);
const previousFindSteps = computed(() =>
  steps.value.filter((step) => step.type === 'findRecords'),
);
/** 条件步可对照：查找 / 创建 / 修改产出的记录 */
const previousRecordSteps = computed(() =>
  steps.value.filter(
    (step) =>
      step.type === 'findRecords' ||
      step.type === 'createRecord' ||
      step.type === 'modifyRecords',
  ),
);

function sheetFields(sheetId: string): FieldDto[] {
  return sheets.value.find((sheet) => sheet.id === sheetId)?.fields ?? [];
}

function fieldName(sheetId: string, fieldId: string): string {
  return sheetFields(sheetId).find((field) => field.id === fieldId)?.name ?? fieldId;
}

function fieldById(sheetId: string, fieldId: string): FieldDto | undefined {
  return sheetFields(sheetId).find((field) => field.id === fieldId);
}

/** 单选/多选：选项 id → 展示名（未领 / 已领） */
function fieldChoices(
  sheetId: string,
  fieldId: string,
): Array<{ id: string; name: string }> {
  const field = fieldById(sheetId, fieldId);
  const choices = field?.options?.choices;
  return Array.isArray(choices)
    ? choices.map((c) => ({ id: String(c.id), name: c.name || String(c.id) }))
    : [];
}

function choiceLabel(sheetId: string, fieldId: string, value: unknown): string {
  const raw = value == null ? '' : String(value);
  if (!raw) return '…';
  const hit = fieldChoices(sheetId, fieldId).find((c) => c.id === raw);
  return hit?.name ?? raw;
}

function errorOf(value: unknown): string {
  return value instanceof ApiError ? value.message : '自动化保存失败';
}

function blankStep(type: StepType): UiStep {
  return {
    id: newId(),
    type,
    name: '',
    sheetId: sheets.value[0]?.id ?? '',
    limit: 1,
    onEmpty: 'continue',
    filterRows: [{ fieldId: '', operator: 'equals', value: '' }],
    filterConjunction: 'and',
    fromStepId: '',
    mappings: [],
    channel: 'doc',
    text: '',
    buttons: [],
    recipientMode: 'trigger',
    recipientField: '',
    userIds: [],
    memberUserIds: [],
    memberUserIdsText: '',
    httpMethod: 'POST',
    httpUrl: '',
    httpHeadersJson: '',
    httpBody: '',
    httpTimeoutMs: 15_000,
    conditionSource: 'trigger',
    delaySeconds: 60,
  };
}

function addStep(type: StepType, atIndex?: number): void {
  const step = blankStep(type);
  if (type === 'modifyRecords') {
    const find = previousFindSteps.value.at(-1);
    step.fromStepId = find?.id ?? '';
    if (find?.sheetId) step.sheetId = find.sheetId;
  }
  if (type === 'findRecords') {
    step.sheetId = triggerSheetId.value || sheets.value[0]?.id || '';
    step.onEmpty = 'stop';
  }
  if (typeof atIndex === 'number') {
    const list = [...steps.value];
    list.splice(atIndex, 0, step);
    steps.value = list;
  } else {
    steps.value = [...steps.value, step];
  }
  addStepOpen.value = false;
  typeMenuStepId.value = '';
}

function changeStepType(step: UiStep, type: StepType): void {
  if (step.type === type) {
    typeMenuStepId.value = '';
    return;
  }
  const next = blankStep(type);
  next.id = step.id;
  next.name = step.name;
  if (type === 'modifyRecords') {
    const find = previousFindSteps.value.find((item) => item.id !== step.id);
    next.fromStepId = find?.id ?? '';
    next.sheetId = find?.sheetId ?? step.sheetId;
  } else if (type === 'findRecords' || type === 'createRecord') {
    next.sheetId = step.sheetId || triggerSheetId.value;
  } else if (type === 'sendMessage') {
    next.text = step.text;
    next.buttons = step.buttons;
    next.channel = step.channel;
    next.recipientMode = step.recipientMode;
    next.recipientField = step.recipientField;
    next.userIds = step.userIds;
  }
  steps.value = steps.value.map((item) => (item.id === step.id ? next : item));
  typeMenuStepId.value = '';
}

function stepTypeMeta(type: StepType) {
  return stepTypes.find((item) => item.value === type);
}

function removeStep(index: number): void {
  steps.value = steps.value.filter((_, itemIndex) => itemIndex !== index);
}

function moveStep(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= steps.value.length) return;
  const list = [...steps.value];
  [list[index], list[target]] = [list[target], list[index]];
  steps.value = list;
}

function stepTypeLabel(type: StepType): string {
  return stepTypes.find((item) => item.value === type)?.label ?? type;
}

function stepTypeIcon(type: StepType): string {
  return stepTypes.find((item) => item.value === type)?.icon ?? '•';
}

function sheetLabel(sheetId: string): string {
  return sheets.value.find((sheet) => sheet.id === sheetId)?.name || '未选表';
}

function operatorLabel(operator: string): string {
  const map: Record<string, string> = {
    equals: '等于',
    notEquals: '不等于',
    contains: '包含',
    isEmpty: '为空',
    isNotEmpty: '不为空',
    gt: '大于',
    lt: '小于',
  };
  return map[operator] ?? operator;
}

function triggerSummary(): string {
  if (triggerType.value === 'schedule') {
    return `按计划运行：${cron.value || '未设 cron'}（${timezone.value}）`;
  }
  if (triggerType.value === 'recordTimer') {
    const sheet = sheetLabel(triggerSheetId.value);
    const field = fieldName(triggerSheetId.value, timerFieldId.value) || '日期字段';
    return `当「${sheet}」的「${field}」到达时`;
  }
  if (triggerType.value === 'formSubmitted') {
    const form = forms.value.find((item) => item.id === triggerFormId.value);
    return `当收集表单「${form?.name ?? '未选'}」提交时`;
  }
  if (triggerType.value === 'recordButton') {
    return `当在「${sheetLabel(triggerSheetId.value)}」点击按钮「${buttonLabel.value || buttonKey.value}」时`;
  }
  const when =
    triggerType.value === 'recordUpdated' ? '记录被更新时' : '新增记录时';
  const sheet = sheetLabel(triggerSheetId.value);
  const conditions = triggerFilters.value
    .filter((row) => row.fieldId)
    .map((row) => formatConditionRow(triggerSheetId.value, row));
  if (conditions.length === 0) {
    return `当「${sheet}」${when}`;
  }
  const joiner = triggerConjunction.value === 'or' ? ' 或 ' : ' 且 ';
  return `当「${sheet}」${when}，满足：${conditions.join(joiner)}`;
}

function stepSummary(step: UiStep): string {
  switch (step.type) {
    case 'findRecords': {
      const sheet = sheetLabel(step.sheetId);
      const conditions = step.filterRows
        .filter((row) => row.fieldId)
        .map((row) => formatConditionRow(step.sheetId, row));
      if (conditions.length === 0) {
        return `在「${sheet}」中查找最多 ${step.limit} 条记录`;
      }
      const joiner = step.filterConjunction === 'or' ? ' 或 ' : ' 且 ';
      return `在「${sheet}」中查找 ${conditions.join(joiner)} 的记录（最多 ${step.limit} 条）`;
    }
    case 'createRecord': {
      const sheet = sheetLabel(step.sheetId);
      const count = step.mappings.filter((row) => row.fieldId).length;
      return count
        ? `在「${sheet}」新增记录，写入 ${count} 个字段`
        : `在「${sheet}」新增记录`;
    }
    case 'modifyRecords': {
      const from =
        steps.value.find((item) => item.id === step.fromStepId)?.id.slice(0, 8) ||
        '上一步';
      const count = step.mappings.filter((row) => row.fieldId).length;
      return count
        ? `修改步骤 ${from} 找到的记录，更新 ${count} 个字段`
        : `修改步骤 ${from} 找到的记录`;
    }
    case 'sendMessage': {
      const preview = step.text.trim().slice(0, 36);
      const who =
        step.recipientMode === 'fixed'
          ? `指定 ${step.userIds.length} 人`
          : step.recipientField
            ? `触发记录的「${step.recipientField}」`
            : '触发相关人员';
      return preview
        ? `向${who}发送「${preview}${step.text.trim().length > 36 ? '…' : ''}」`
        : `向${who}发送消息`;
    }
    case 'sendHttp': {
      const url = step.httpUrl.trim() || '…';
      return `${step.httpMethod} ${url.length > 40 ? `${url.slice(0, 40)}…` : url}`;
    }
    case 'condition': {
      const sheetId =
        step.conditionSource === 'trigger'
          ? triggerSheetIdForFields.value
          : steps.value.find((item) => item.id === step.conditionSource)
              ?.sheetId ?? triggerSheetIdForFields.value;
      const conditions = step.filterRows
        .filter((row) => row.fieldId)
        .map((row) => formatConditionRow(sheetId, row));
      const joiner = step.filterConjunction === 'or' ? ' 或 ' : ' 且 ';
      return conditions.length
        ? `若满足 ${conditions.join(joiner)}，否则跳过后续`
        : '条件判断（未配置）';
    }
    case 'delay':
      return `等待 ${step.delaySeconds} 秒后继续`;
    default:
      return stepTypeLabel(step.type);
  }
}

function stepSheetId(step: UiStep): string {
  if (step.type === 'modifyRecords') {
    return (
      steps.value.find((candidate) => candidate.id === step.fromStepId)?.sheetId ??
      ''
    );
  }
  return step.sheetId;
}

function addMapping(step: UiStep): void {
  step.mappings = [
    ...step.mappings,
    {
      fieldId: '',
      mode: 'literal',
      value: '',
      variableSource: 'trigger',
      variableField: '',
    },
  ];
}

function removeMapping(step: UiStep, index: number): void {
  step.mappings = step.mappings.filter((_, itemIndex) => itemIndex !== index);
}

function addTriggerFilter(): void {
  triggerFilters.value = [
    ...triggerFilters.value,
    { fieldId: '', operator: 'equals', value: '' },
  ];
}

function removeTriggerFilter(index: number): void {
  triggerFilters.value = triggerFilters.value.filter(
    (_, itemIndex) => itemIndex !== index,
  );
  if (triggerFilters.value.length === 0) {
    triggerFilters.value = [{ fieldId: '', operator: 'equals', value: '' }];
  }
}

function addFindFilterRow(step: UiStep): void {
  step.filterRows = [
    ...step.filterRows,
    { fieldId: '', operator: 'equals', value: '' },
  ];
}

function removeFindFilterRow(step: UiStep, index: number): void {
  step.filterRows = step.filterRows.filter((_, itemIndex) => itemIndex !== index);
  if (step.filterRows.length === 0) {
    step.filterRows = [{ fieldId: '', operator: 'equals', value: '' }];
  }
}

type FilterRowInput = {
  fieldId?: string;
  operator?: string;
  value?: unknown;
  conditions?: unknown[];
};

function parseFilterRows(
  filters:
    | {
        conjunction?: 'and' | 'or';
        conditions?: FilterRowInput[];
      }
    | undefined,
): {
  conjunction: 'and' | 'or';
  rows: Array<{ fieldId: string; operator: string; value: string }>;
} {
  const conjunction = filters?.conjunction === 'or' ? 'or' : 'and';
  const rows = (filters?.conditions ?? [])
    .filter((node) => node && !Array.isArray(node.conditions) && node.fieldId)
    .map((condition) => ({
      fieldId: condition.fieldId ?? '',
      operator: condition.operator ?? 'equals',
      value: condition.value === undefined ? '' : String(condition.value),
    }));
  return {
    conjunction,
    rows: rows.length
      ? rows
      : [{ fieldId: '', operator: 'equals', value: '' }],
  };
}

function formatConditionRow(
  sheetId: string,
  row: { fieldId: string; operator: string; value: string },
): string {
  const field = fieldName(sheetId, row.fieldId);
  if (row.operator === 'isEmpty' || row.operator === 'isNotEmpty') {
    return `${field}${operatorLabel(row.operator)}`;
  }
  const shown = choiceLabel(sheetId, row.fieldId, row.value);
  return `${field}${operatorLabel(row.operator)}「${shown}」`;
}

function fieldOptions(sheetId: string): FieldDto[] {
  return sheetFields(sheetId);
}

function variableFieldsFor(step: UiStep): string[] {
  const targetSheetId = stepSheetId(step);
  const names = new Set<string>();
  for (const field of triggerFields.value) names.add(field.name);
  for (const field of sheetFields(targetSheetId)) names.add(field.name);
  for (const candidate of steps.value) {
    if (candidate.id === step.id) break;
    for (const field of sheetFields(stepSheetId(candidate))) {
      names.add(field.name);
    }
  }
  return [...names];
}

function triggerStepMenuLabel(): string {
  if (triggerType.value === 'recordUpdated') return '第1步更新记录的';
  if (triggerType.value === 'schedule') return '第1步定时触发的';
  return '第1步新增记录的';
}

function stepMenuLabel(stepNo: number, type: StepType): string {
  const action =
    type === 'findRecords'
      ? '查找记录'
      : type === 'modifyRecords'
        ? '修改记录'
        : type === 'createRecord'
          ? '新增记录'
          : type === 'sendMessage'
            ? '发送消息'
            : stepTypeLabel(type);
  return `第${stepNo}步${action}的`;
}

function variableMenuGroups(step: UiStep): VariableMenuGroup[] {
  const groups: VariableMenuGroup[] = [
    {
      label: '自然时间',
      items: [
        { label: '今天', token: '今天' },
        { label: '明天', token: '明天' },
        { label: '昨天', token: '昨天' },
      ],
    },
  ];
  const triggerItems: VariableMenuGroup['items'] = [
    { label: '记录链接', token: '第1步.记录链接' },
    { label: '操作时间', token: '第1步.操作时间' },
    { label: '操作人', token: '第1步.操作人' },
    { label: '填写者', token: '第1步.填写者' },
    { label: '提交时间', token: '第1步.提交时间' },
    ...triggerFields.value.map((field) => ({
      label: field.name,
      token: `第1步.${field.name}`,
    })),
  ];
  groups.push({ label: triggerStepMenuLabel(), items: triggerItems });

  steps.value.forEach((candidate, index) => {
    if (candidate.id === step.id) return;
    const stepNo = index + 2;
    const fields = sheetFields(stepSheetId(candidate));
    const metaItems: VariableMenuGroup['items'] =
      candidate.type === 'findRecords' || candidate.type === 'modifyRecords'
        ? [
            { label: '记录链接', token: `第${stepNo}步.记录链接` },
            { label: '操作时间', token: `第${stepNo}步.操作时间` },
            { label: '操作人', token: `第${stepNo}步.操作人` },
          ]
        : [];
    groups.push({
      label: stepMenuLabel(stepNo, candidate.type),
      items: [
        ...metaItems,
        ...fields.map((field) => ({
          label: field.name,
          token: `第${stepNo}步.${field.name}`,
        })),
      ],
    });
  });
  return groups;
}

type MessagePart =
  | { kind: 'text'; value: string }
  | { kind: 'var'; token: string; label: string };

function tokenDisplayLabel(token: string): string {
  const parts = token.split('.');
  if (parts.length >= 2) {
    const stepBit = parts[0] ?? '';
    const fieldBit = parts.slice(1).join('.');
    // 「第3步修改记录的 序列号」：用菜单组名拼展示
    const stepMatch = /^第(\d+)步/.exec(stepBit);
    if (stepMatch) {
      const no = Number(stepMatch[1]);
      if (no === 1) return `${triggerStepMenuLabel()} ${fieldBit}`;
      const step = steps.value[no - 2];
      if (step) return `${stepMenuLabel(no, step.type)} ${fieldBit}`;
    }
  }
  return token;
}

function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      parts.push({ kind: 'text', value: text.slice(last, match.index) });
    }
    const token = match[1] ?? '';
    parts.push({
      kind: 'var',
      token,
      label: tokenDisplayLabel(token),
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', value: text.slice(last) });
  }
  return parts;
}

function serializeMessageParts(parts: MessagePart[]): string {
  return parts
    .map((part) =>
      part.kind === 'var' ? `{{${part.token}}}` : part.value,
    )
    .join('');
}

function flushMessageTail(step: UiStep): void {
  const tail = messageTailByStep.value[step.id] ?? '';
  if (!tail) return;
  step.text = `${step.text}${tail}`;
  messageTailByStep.value = { ...messageTailByStep.value, [step.id]: '' };
}

function insertVariableToken(step: UiStep, token: string): void {
  flushMessageTail(step);
  step.text = `${step.text}{{${token}}}`;
  variableMenuStepId.value = '';
  variableMenuGroup.value = '';
}

function removeMessageVar(step: UiStep, partIndex: number): void {
  const parts = messageParts(step.text);
  parts.splice(partIndex, 1);
  step.text = serializeMessageParts(parts);
}

function recipientPillLabel(step: UiStep): string {
  const field = step.recipientField?.trim() || '填写者';
  return `${triggerStepMenuLabel()} ${field}`;
}

function openContentEditor(step: UiStep): void {
  if (step.mappings.length === 0) addMapping(step);
  contentEditorStepId.value = step.id;
  filterEditorStepId.value = '';
}

function closeContentEditor(): void {
  contentEditorStepId.value = '';
}

function contentEditorStep(): UiStep | null {
  return steps.value.find((step) => step.id === contentEditorStepId.value) ?? null;
}

function openFilterEditor(step: UiStep): void {
  filterEditorStepId.value = step.id;
  contentEditorStepId.value = '';
}

function closeFilterEditor(): void {
  filterEditorStepId.value = '';
}

function filterEditorStep(): UiStep | null {
  return steps.value.find((step) => step.id === filterEditorStepId.value) ?? null;
}

function findFilterSummary(step: UiStep): string {
  const conditions = step.filterRows
    .filter((row) => row.fieldId)
    .map((row) => formatConditionRow(step.sheetId, row));
  if (conditions.length === 0) return '满足条件的记录';
  if (conditions.length === 1) return conditions[0];
  const joiner = step.filterConjunction === 'or' ? ' 或 ' : ' 且 ';
  return conditions.join(joiner);
}

function findStepOptionLabel(candidate: UiStep): string {
  const idx = steps.value.findIndex((item) => item.id === candidate.id);
  return `第 ${idx + 2} 步查找的记录`;
}

function onModifyFromStepChange(step: UiStep): void {
  const source = steps.value.find((item) => item.id === step.fromStepId);
  if (source?.sheetId) step.sheetId = source.sheetId;
}

function setFindOnEmpty(step: UiStep, value: 'continue' | 'stop'): void {
  step.onEmpty = value;
  onFindEmpty.value = value;
}

function insertEmoji(step: UiStep, emoji: string): void {
  flushMessageTail(step);
  step.text = `${step.text}${emoji}`;
  emojiMenuStepId.value = '';
}

function setMessageTail(step: UiStep, value: string): void {
  messageTailByStep.value = { ...messageTailByStep.value, [step.id]: value };
}

function openButtonDraft(step: UiStep): void {
  buttonDraft.value = { stepId: step.id, title: '前往查看', url: '{{第1步.记录链接}}' };
}

function confirmButton(): void {
  const draft = buttonDraft.value;
  if (!draft) return;
  const step = steps.value.find((item) => item.id === draft.stepId);
  if (step && draft.title.trim() && draft.url.trim()) {
    step.buttons = [
      ...step.buttons,
      { title: draft.title.trim(), url: draft.url.trim() },
    ];
  }
  buttonDraft.value = null;
}

function removeButton(step: UiStep, index: number): void {
  step.buttons = step.buttons.filter((_, i) => i !== index);
}

function memberName(userId: string): string {
  return (
    members.value.find((member) => member.userId === userId)?.account ?? userId
  );
}

function toggleUser(step: UiStep, userId: string): void {
  step.userIds = step.userIds.includes(userId)
    ? step.userIds.filter((id) => id !== userId)
    : [...step.userIds, userId];
}

function toggleMember(step: UiStep, userId: string): void {
  step.memberUserIds = step.memberUserIds.includes(userId)
    ? step.memberUserIds.filter((id) => id !== userId)
    : [...step.memberUserIds, userId];
}

function buildFilter(
  rows: Array<{ fieldId: string; operator: string; value: string }>,
  conjunction: 'and' | 'or' = 'and',
) {
  const conditions = rows
    .filter((row) => row.fieldId)
    .map((row) => ({
      fieldId: row.fieldId,
      operator: row.operator,
      value:
        row.operator === 'isEmpty' || row.operator === 'isNotEmpty'
          ? undefined
          : row.value,
    }));
  return conditions.length ? { conjunction, conditions } : undefined;
}

function buildMappings(step: UiStep) {
  const cells: Record<string, unknown> = {};
  const stepIndex = steps.value.findIndex((item) => item.id === step.id);
  const boundFind = steps.value
    .slice(0, Math.max(0, stepIndex))
    .find((item) => item.type === 'findRecords');
  for (const mapping of step.mappings) {
    if (!mapping.fieldId) continue;
    if (mapping.mode === 'literal') {
      cells[mapping.fieldId] = {
        kind: 'literal',
        value: mapping.value,
      };
    } else {
      cells[mapping.fieldId] = {
        kind: 'variable',
        variable:
          mapping.variableSource === 'trigger'
            ? { source: 'trigger', field: mapping.variableField }
            : {
                source: 'step',
                stepId: step.fromStepId || boundFind?.id,
                field: mapping.variableField,
              },
      };
    }
  }
  return cells;
}

function buildTrigger(): Record<string, unknown> {
  if (triggerType.value === 'schedule') {
    return {
      type: 'schedule',
      cron: cron.value.trim(),
      timezone: timezone.value,
    };
  }
  if (triggerType.value === 'recordTimer') {
    return {
      type: 'recordTimer',
      sheetId: triggerSheetId.value,
      fieldId: timerFieldId.value,
      filters: buildFilter(triggerFilters.value, triggerConjunction.value),
    };
  }
  if (triggerType.value === 'formSubmitted') {
    return {
      type: 'formSubmitted',
      formId: triggerFormId.value,
      filters: buildFilter(triggerFilters.value, triggerConjunction.value),
    };
  }
  if (triggerType.value === 'recordButton') {
    return {
      type: 'recordButton',
      sheetId: triggerSheetId.value,
      buttonKey: buttonKey.value.trim(),
      buttonLabel: buttonLabel.value.trim(),
      filters: buildFilter(triggerFilters.value, triggerConjunction.value),
    };
  }
  return {
    type: triggerType.value,
    sheetId: triggerSheetId.value,
    filters: buildFilter(triggerFilters.value, triggerConjunction.value),
  };
}

function buildSteps(): Array<Record<string, unknown>> {
  return steps.value.map((step) => {
    switch (step.type) {
      case 'findRecords':
        return {
          id: step.id,
          type: step.type,
          sheetId: step.sheetId,
          limit: step.limit,
          onEmpty: step.onEmpty,
          filters: buildFilter(step.filterRows, step.filterConjunction),
        };
      case 'createRecord':
        return {
          id: step.id,
          type: step.type,
          sheetId: step.sheetId,
          cells: buildMappings(step),
        };
      case 'modifyRecords':
        return {
          id: step.id,
          type: step.type,
          target: { mode: 'fromStep', stepId: step.fromStepId },
          cells: buildMappings(step),
        };
      case 'sendMessage': {
        flushMessageTail(step);
        return {
          id: step.id,
          type: step.type,
          channel: step.channel || 'doc',
          recipients:
            step.recipientMode === 'fixed'
              ? [{ source: 'fixed', userIds: step.userIds }]
              : [{ source: 'trigger', field: step.recipientField || '填写者' }],
          content: {
            text: step.text,
            ...(step.buttons.length
              ? {
                  buttons: step.buttons.map((button) => ({
                    title: button.title,
                    url: button.url,
                  })),
                }
              : {}),
          },
        };
      }
      case 'sendHttp': {
        let headers: Record<string, string> | undefined;
        const rawHeaders = step.httpHeadersJson.trim();
        if (rawHeaders) {
          try {
            const parsed = JSON.parse(rawHeaders) as unknown;
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              Array.isArray(parsed)
            ) {
              throw new Error('headers');
            }
            headers = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(
                ([key, value]) => [key, String(value)],
              ),
            );
          } catch {
            headers = undefined;
          }
        }
        return {
          id: step.id,
          type: step.type,
          method: step.httpMethod,
          url: step.httpUrl,
          ...(headers ? { headers } : {}),
          ...(step.httpBody.trim() ? { body: step.httpBody } : {}),
          timeoutMs: step.httpTimeoutMs,
        };
      }
      case 'condition':
        return {
          id: step.id,
          type: step.type,
          source:
            step.conditionSource === 'trigger'
              ? 'trigger'
              : { stepId: step.conditionSource },
          filters: buildFilter(step.filterRows, step.filterConjunction),
        };
      case 'delay':
        return {
          id: step.id,
          type: step.type,
          delayMs: Math.max(1, Math.floor(step.delaySeconds)) * 1000,
        };
      default:
        return { id: step.id, type: step.type };
    }
  });
}

function validate(): string {
  if (!name.value.trim()) return '请输入自动化名称';
  if (
    triggerType.value !== 'schedule' &&
    triggerType.value !== 'formSubmitted' &&
    !triggerSheetId.value
  ) {
    return '请选择触发工作表';
  }
  if (triggerType.value === 'formSubmitted' && !triggerFormId.value) {
    return '请选择收集表单';
  }
  if (triggerType.value === 'recordButton') {
    if (!buttonKey.value.trim()) return '请填写按钮键';
    if (!buttonLabel.value.trim()) return '请填写按钮名称';
  }
  if (triggerType.value === 'schedule' && !cron.value.trim()) {
    return '请输入 cron 表达式';
  }
  if (triggerType.value === 'recordTimer' && !timerFieldId.value) {
    return '请选择到达时间的日期字段';
  }
  if (steps.value.length === 0) return '至少添加一个执行步骤';
  for (const [index, step] of steps.value.entries()) {
    if (
      (step.type === 'findRecords' ||
        step.type === 'createRecord' ||
        step.type === 'modifyRecords') &&
      !stepSheetId(step)
    ) {
      return `第 ${index + 1} 步缺少目标工作表`;
    }
    if (step.type === 'modifyRecords' && !step.fromStepId) {
      return `第 ${index + 1} 步需要绑定之前的查找记录步骤`;
    }
    if (step.type === 'condition') {
      const hasField = step.filterRows.some((row) => row.fieldId);
      if (!hasField) return `第 ${index + 1} 步条件缺少字段`;
    }
    if (step.type === 'delay') {
      if (step.delaySeconds < 1 || step.delaySeconds > 86_400) {
        return `第 ${index + 1} 步延迟需在 1 秒～24 小时`;
      }
    }
    if (step.type === 'sendMessage') {
      flushMessageTail(step);
      if (!step.text.trim()) {
        return `第 ${index + 1} 步消息内容不能为空`;
      }
    }
    if (step.type === 'sendHttp') {
      if (!step.httpUrl.trim()) {
        return `第 ${index + 1} 步 HTTP 请求缺少 URL`;
      }
      if (step.httpHeadersJson.trim()) {
        try {
          const parsed = JSON.parse(step.httpHeadersJson) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return `第 ${index + 1} 步请求头须为 JSON 对象`;
          }
        } catch {
          return `第 ${index + 1} 步请求头 JSON 不合法`;
        }
      }
    }
  }
  return '';
}

async function save(mode: 'draft' | 'enable' = 'draft'): Promise<void> {
  const validation = validate();
  if (validation) {
    error.value = validation;
    return;
  }
  if (mode === 'enable') enabled.value = true;
  saving.value = true;
  error.value = '';
  try {
    const body = {
      name: name.value.trim() || '未命名流程',
      enabled: mode === 'enable' ? true : enabled.value,
      trigger: buildTrigger(),
      steps: buildSteps(),
      onFindEmpty: onFindEmpty.value,
      monthlyQuota: monthlyQuota.value,
    };
    if (!navigator.onLine) {
      const { enqueueObjectMutation } = await import('../sync/object-outbox');
      const { offlineDecision, offlineBlockMessage } = await import(
        '../sync/offline-capability'
      );
      if (offlineDecision('automation.edit') === 'block') {
        error.value = offlineBlockMessage('automation.edit');
        return;
      }
      await enqueueObjectMutation({
        type: 'automation.upsert',
        automationId: props.automation?.id,
        baseId: props.baseId,
        body,
      });
      const now = new Date().toISOString();
      const localSaved: AutomationDto = {
        ...(props.automation ?? {
          id: `offline-${Date.now()}`,
          baseId: props.baseId,
          name: body.name,
          enabled: body.enabled ?? false,
          trigger: body.trigger,
          steps: body.steps as unknown[],
          onFindEmpty: body.onFindEmpty ?? 'continue',
          monthlyQuota: body.monthlyQuota ?? null,
          createdAt: now,
          updatedAt: now,
        }),
        name: body.name,
        enabled: body.enabled ?? false,
        trigger: body.trigger,
        steps: body.steps as unknown[],
        onFindEmpty: body.onFindEmpty ?? 'continue',
        monthlyQuota: body.monthlyQuota ?? null,
        updatedAt: now,
      };
      emit('saved', localSaved);
      return;
    }
    const saved = props.automation
      ? await endpoints.updateAutomation(props.automation.id, body)
      : await endpoints.createAutomation({
          baseId: props.baseId,
          ...body,
        });
    emit('saved', saved);
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    saving.value = false;
  }
}

function toUiStep(raw: Record<string, unknown>, index: number): UiStep {
  const type = String(raw.type) as StepType;
  const step = blankStep(type);
  step.id = String(raw.id ?? newId());
  step.name = String(raw.name ?? `步骤 ${index + 1}`);
  step.sheetId = String(raw.sheetId ?? '');
  step.limit = Number(raw.limit ?? 1) || 1;
  step.onEmpty = raw.onEmpty === 'stop' ? 'stop' : 'continue';
  const parsedFilters = parseFilterRows(
    raw.filters as
      | {
          conjunction?: 'and' | 'or';
          conditions?: FilterRowInput[];
        }
      | undefined,
  );
  step.filterConjunction = parsedFilters.conjunction;
  step.filterRows = parsedFilters.rows;
  const target = raw.target as { stepId?: string } | undefined;
  step.fromStepId = String(raw.fromStepId ?? target?.stepId ?? '');
  const content = raw.content as { text?: string } | undefined;
  step.text = content?.text ?? '';
  const buttons = (content as { buttons?: Array<{ title?: string; url?: string }> } | undefined)
    ?.buttons;
  step.buttons = Array.isArray(buttons)
    ? buttons.map((button) => ({
        title: String(button.title ?? ''),
        url: String(button.url ?? ''),
      }))
    : [];
  step.channel = 'doc';
  const recipients = raw.recipients as
    | Array<{ source?: string; userIds?: string[]; field?: string }>
    | undefined;
  step.recipientMode =
    recipients?.[0]?.source === 'fixed' ? 'fixed' : 'trigger';
  step.recipientField = String(recipients?.[0]?.field ?? '');
  step.userIds = recipients?.[0]?.userIds ?? [];
  step.memberUserIds = Array.isArray(raw.memberUserIds)
    ? raw.memberUserIds.map(String)
    : [];
  step.name = String(raw.name ?? '');
  const cells = (raw.cells ?? {}) as Record<
    string,
    { kind?: string; value?: unknown; variable?: { field?: string; source?: string } }
  >;
  step.mappings = Object.entries(cells).map(([fieldId, expression]) => ({
    fieldId,
    mode: expression.kind === 'variable' ? 'variable' : 'literal',
    value:
      expression.value === undefined ? '' : String(expression.value),
    variableSource:
      expression.variable?.source === 'step' ? 'step' : 'trigger',
    variableField: expression.variable?.field ?? '',
  }));
  const method = String(raw.method ?? 'POST').toUpperCase();
  step.httpMethod = (
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? method
      : 'POST'
  ) as UiStep['httpMethod'];
  step.httpUrl = String(raw.url ?? '');
  step.httpBody = String(raw.body ?? '');
  step.httpTimeoutMs = Number(raw.timeoutMs ?? 15_000) || 15_000;
  const headers = raw.headers;
  step.httpHeadersJson =
    headers && typeof headers === 'object' && !Array.isArray(headers)
      ? JSON.stringify(headers, null, 2)
      : '';
  if (type === 'condition') {
    const source = raw.source;
    step.conditionSource =
      source &&
      typeof source === 'object' &&
      typeof (source as { stepId?: string }).stepId === 'string'
        ? String((source as { stepId: string }).stepId)
        : 'trigger';
  }
  if (type === 'delay') {
    const ms = Number(raw.delayMs ?? 60_000);
    step.delaySeconds = Math.max(1, Math.round(ms / 1000) || 60);
  }
  return step;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const sheetList = await endpoints.listSheets(props.baseId);
    sheets.value = await Promise.all(
      sheetList.map((sheet) => endpoints.getSheet(sheet.id)),
    );
    forms.value = await endpoints
      .listForms(props.baseId)
      .then((list) =>
        list.map((item) => ({
          id: item.id,
          name: item.name,
          sheetId: item.sheetId,
        })),
      )
      .catch(() => [] as Array<{ id: string; name: string; sheetId: string }>);
    members.value = await endpoints.listMembers(
      // Members are only used for pickers; the API call is safe to skip on error.
      (await endpoints.getBase(props.baseId)).workspaceId,
    ).catch(() => [] as MemberDto[]);
    const triggerSheetCandidate = sheets.value[0]?.id ?? '';
    const typedDuringLoad = name.value.trim();

    const automation = props.automation;
    if (!automation) {
      // Keep any title / sheet the user already chose while sheets were loading.
      if (!typedDuringLoad) name.value = '未命名流程';
      if (!triggerSheetId.value) triggerSheetId.value = triggerSheetCandidate;
      if (!triggerFormId.value && forms.value[0]) {
        triggerFormId.value = forms.value[0].id;
      }
      enabled.value = false;
      return;
    }
    name.value =
      typedDuringLoad && typedDuringLoad !== automation.name
        ? typedDuringLoad
        : automation.name;
    enabled.value = automation.enabled;
    const trigger = automation.trigger as Record<string, unknown>;
    const type = String(trigger.type ?? 'recordCreated');
    triggerType.value =
      type === 'schedule' ||
      type === 'recordTimer' ||
      type === 'recordUpdated' ||
      type === 'formSubmitted' ||
      type === 'recordButton' ||
      type === 'recordCreated'
        ? type
        : 'recordCreated';
    timerFieldId.value = String(trigger.fieldId ?? '');
    triggerSheetId.value = String(trigger.sheetId ?? triggerSheetCandidate);
    triggerFormId.value = String(
      trigger.formId ?? forms.value[0]?.id ?? '',
    );
    buttonKey.value = String(trigger.buttonKey ?? 'run');
    buttonLabel.value = String(trigger.buttonLabel ?? '运行');
    cron.value = String(trigger.cron ?? '0 9 * * *');
    timezone.value = String(trigger.timezone ?? 'Asia/Shanghai');
    const parsedTriggerFilters = parseFilterRows(
      trigger.filters as
        | {
            conjunction?: 'and' | 'or';
            conditions?: FilterRowInput[];
          }
        | undefined,
    );
    triggerConjunction.value = parsedTriggerFilters.conjunction;
    triggerFilters.value = parsedTriggerFilters.rows;
    onFindEmpty.value =
      automation.onFindEmpty === 'stop' ? 'stop' : 'continue';
    monthlyQuota.value = automation.monthlyQuota;
    steps.value = (automation.steps as Array<Record<string, unknown>>).map(
      (step, index) => toUiStep(step, index),
    );
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="automation-editor" data-testid="automation-editor">
    <header class="editor-head">
      <div class="editor-title-row">
        <button class="icon-btn" type="button" aria-label="返回" @click="emit('close')">
          ←
        </button>
        <input
          v-model="name"
          class="editor-title-input"
          data-testid="automation-name"
          maxlength="120"
          placeholder="未命名流程"
        />
      </div>
      <div class="editor-head-actions">
        <button
          v-if="props.automation"
          class="btn ghost small"
          type="button"
          data-testid="automation-editor-runs"
          @click="emit('open-runs')"
        >
          运行日志
        </button>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <p v-if="error" class="editor-error" data-testid="automation-editor-error">{{ error }}</p>

      <section class="nl-section">
        <h4 class="nl-section-title">当满足以下条件</h4>
        <div class="timeline-block">
          <div class="timeline-rail">
            <span class="timeline-dot" />
            <span class="timeline-line" />
          </div>
          <div class="timeline-main">
            <div class="timeline-step-no">第1步</div>
        <div class="nl-card" data-testid="automation-trigger-card">
          <div class="nl-sentence" data-testid="automation-trigger-summary">
            <select v-model="triggerType" class="nl-chip" data-testid="trigger-type">
              <option value="recordCreated">添加新记录时</option>
              <option value="recordUpdated">更新记录时</option>
              <option value="formSubmitted">收集表单提交时</option>
              <option value="recordButton">点击记录按钮时</option>
              <option value="schedule">定时触发</option>
              <option value="recordTimer">到达记录时间</option>
            </select>
            <template v-if="triggerType === 'schedule'">
              <span>按</span>
              <input v-model="cron" class="nl-chip nl-chip-input" data-testid="trigger-cron" />
              <select v-model="timezone" class="nl-chip" data-testid="trigger-timezone">
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="UTC">UTC</option>
              </select>
            </template>
            <template v-else-if="triggerType === 'formSubmitted'">
              <span>在</span>
              <select
                v-model="triggerFormId"
                class="nl-chip"
                data-testid="trigger-form"
              >
                <option value="">选择表单</option>
                <option
                  v-for="form in forms"
                  :key="form.id"
                  :value="form.id"
                >
                  {{ form.name }}
                </option>
              </select>
              <span>提交时</span>
            </template>
            <template v-else>
              <span>在</span>
              <select v-model="triggerSheetId" class="nl-chip" data-testid="trigger-sheet">
                <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                  {{ sheet.name }}
                </option>
              </select>
              <template v-if="triggerType === 'recordButton'">
                <span>点击按钮</span>
                <input
                  v-model="buttonLabel"
                  class="nl-chip nl-chip-input"
                  data-testid="trigger-button-label"
                  placeholder="按钮名称"
                />
                <input
                  v-model="buttonKey"
                  class="nl-chip nl-chip-input"
                  data-testid="trigger-button-key"
                  placeholder="buttonKey"
                />
                <span>时</span>
              </template>
              <template v-else-if="triggerType === 'recordTimer'">
                <span>的</span>
                <select
                  v-model="timerFieldId"
                  class="nl-chip"
                  data-testid="timer-field"
                >
                  <option value="">选择日期字段</option>
                  <option
                    v-for="field in triggerFields.filter((item) => item.type === 'date')"
                    :key="field.id"
                    :value="field.id"
                  >
                    {{ field.name }}
                  </option>
                </select>
                <span>到达时</span>
              </template>
              <span v-else
                >里{{
                  triggerType === 'recordCreated' ? '添加新记录' : '更新记录'
                }}时</span
              >
            </template>
          </div>

          <div
            v-if="triggerType !== 'schedule'"
            class="nl-filters"
          >
            <div class="nl-sentence">
              <span>满足以下</span>
              <select
                v-model="triggerConjunction"
                class="nl-chip"
                data-testid="trigger-filter-conjunction"
              >
                <option value="and">全部</option>
                <option value="or">任意</option>
              </select>
              <span>条件</span>
            </div>
            <div
              v-for="(filter, index) in triggerFilters"
              :key="index"
              class="nl-sentence"
              data-testid="trigger-condition"
            >
              <span>{{
                index === 0
                  ? '当'
                  : triggerConjunction === 'or'
                    ? '或者'
                    : '并且'
              }}</span>
              <select v-model="filter.fieldId" class="nl-chip" data-testid="trigger-filter-field">
                <option value="">选择字段</option>
                <option v-for="field in triggerFields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
              <select v-model="filter.operator" class="nl-chip">
                <option value="equals">等于</option>
                <option value="notEquals">不等于</option>
                <option value="contains">包含</option>
                <option value="notContains">不包含</option>
                <option value="isEmpty">为空</option>
                <option value="isNotEmpty">不为空</option>
                <option value="gt">大于</option>
                <option value="lt">小于</option>
              </select>
              <select
                v-if="
                  filter.operator !== 'isEmpty' &&
                  filter.operator !== 'isNotEmpty' &&
                  fieldChoices(triggerSheetIdForFields, filter.fieldId).length
                "
                v-model="filter.value"
                class="nl-chip"
              >
                <option value="">选择选项</option>
                <option
                  v-for="choice in fieldChoices(
                    triggerSheetIdForFields,
                    filter.fieldId,
                  )"
                  :key="choice.id"
                  :value="choice.id"
                >
                  {{ choice.name }}
                </option>
              </select>
              <input
                v-else-if="filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty'"
                v-model="filter.value"
                class="nl-chip nl-chip-input"
                placeholder="值"
              />
              <button class="icon-btn danger" type="button" @click="removeTriggerFilter(index)">
                ×
              </button>
            </div>
            <button
              class="nl-add-link"
              type="button"
              data-testid="trigger-add-filter"
              @click="addTriggerFilter"
            >
              + 添加条件
            </button>
            <p class="nl-hint">
              {{
                triggerConjunction === 'or'
                  ? '任一条件满足即可触发后续操作'
                  : '条件未全部满足时，不会触发后续操作'
              }}
            </p>
          </div>
        </div>
          </div>
        </div>
      </section>

      <section class="nl-section">
        <div class="nl-section-head">
          <h4 class="nl-section-title">就执行以下操作</h4>
        </div>

        <div v-if="steps.length === 0" class="empty-steps">
          <p class="empty-steps-title">还没有操作步骤</p>
          <p class="empty-steps-hint">添加查找、修改或发送消息等操作，组成自动化流程。</p>
          <button
            class="btn btn-primary"
            type="button"
            data-testid="automation-add-step-empty"
            @click="addStepOpen = true; typeMenuStepId = ''"
          >
            + 添加操作
          </button>
        </div>

        <div
          v-for="(step, index) in steps"
          :key="step.id"
          class="timeline-block"
        >
          <div class="timeline-rail">
            <span class="timeline-dot" />
            <span class="timeline-line" />
          </div>
          <div class="timeline-main">
            <div class="timeline-step-no">第{{ index + 2 }}步</div>
        <article
          class="nl-card step-card"
          :data-testid="`automation-step-${step.type}`"
        >
          <div class="nl-card-head">
            <div class="type-picker">
              <button
                type="button"
                class="type-trigger"
                data-testid="step-type-trigger"
                @click="
                  typeMenuStepId =
                    typeMenuStepId === step.id ? '' : step.id;
                  addStepOpen = false;
                "
              >
                <span
                  class="type-badge"
                  :style="{
                    background: stepTypeMeta(step.type)?.color ?? '#1d6fdc',
                  }"
                >
                  {{ stepTypeMeta(step.type)?.icon }}
                </span>
                {{ stepTypeLabel(step.type) }}
                <span class="chevron">▾</span>
              </button>
              <Transition name="menu-fade">
                <div
                  v-if="typeMenuStepId === step.id"
                  class="add-step-menu type-menu"
                  data-testid="step-type-menu"
                >
                  <button
                    v-for="item in stepTypes"
                    :key="item.value"
                    type="button"
                    :data-testid="`change-step-${item.value}`"
                    @click="changeStepType(step, item.value)"
                  >
                    <span
                      class="type-badge small"
                      :style="{ background: item.color }"
                    >{{ item.icon }}</span>
                    {{ item.label }}
                    <span v-if="item.value === step.type" class="check">✓</span>
                  </button>
                </div>
              </Transition>
            </div>
            <div class="nl-card-actions">
              <button class="icon-btn danger" type="button" title="删除" @click="removeStep(index)">🗑</button>
            </div>
          </div>

          <div class="step-body">
            <template v-if="step.type === 'findRecords'">
              <div class="nl-sentence">
                <span>在</span>
                <select v-model="step.sheetId" class="nl-chip" data-testid="step-sheet">
                  <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                    {{ sheet.name }}
                  </option>
                </select>
                <span>里，查找</span>
                <button
                  class="nl-chip nl-chip-btn"
                  type="button"
                  data-testid="step-open-filter"
                  @click="openFilterEditor(step)"
                >
                  {{ findFilterSummary(step) }}
                </button>
              </div>
              <div class="on-empty-block">
                <span class="on-empty-label">未查找到记录时</span>
                <label class="radio-pill">
                  <input
                    type="radio"
                    :name="`on-empty-${step.id}`"
                    :checked="step.onEmpty === 'continue'"
                    @change="setFindOnEmpty(step, 'continue')"
                  />
                  继续执行
                </label>
                <label class="radio-pill">
                  <input
                    type="radio"
                    :name="`on-empty-${step.id}`"
                    :checked="step.onEmpty === 'stop'"
                    @change="setFindOnEmpty(step, 'stop')"
                  />
                  终止
                </label>
              </div>
            </template>

            <template v-else-if="step.type === 'createRecord'">
              <div class="nl-sentence">
                <span>在</span>
                <select v-model="step.sheetId" class="nl-chip" data-testid="step-sheet">
                  <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                    {{ sheet.name }}
                  </option>
                </select>
                <span>中新增一条记录，并写入：</span>
              </div>
              <div class="mapping-head">
                <span>字段写入</span>
                <button class="btn small" type="button" @click="addMapping(step)">+ 字段</button>
              </div>
              <div v-for="(mapping, mappingIndex) in step.mappings" :key="mappingIndex" class="mapping-row">
                <select v-model="mapping.fieldId">
                  <option value="">选择字段</option>
                  <option v-for="field in fieldOptions(step.sheetId)" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
                <select v-model="mapping.mode">
                  <option value="literal">固定值</option>
                  <option value="variable">变量</option>
                </select>
                <select
                  v-if="
                    mapping.mode === 'literal' &&
                    fieldChoices(step.sheetId, mapping.fieldId).length
                  "
                  v-model="mapping.value"
                >
                  <option value="">选择选项</option>
                  <option
                    v-for="choice in fieldChoices(step.sheetId, mapping.fieldId)"
                    :key="choice.id"
                    :value="choice.id"
                  >
                    {{ choice.name }}
                  </option>
                </select>
                <input
                  v-else-if="mapping.mode === 'literal'"
                  v-model="mapping.value"
                  placeholder="值"
                />
                <template v-else>
                  <select v-model="mapping.variableSource">
                    <option value="trigger">触发记录</option>
                    <option value="step">前序步骤</option>
                  </select>
                  <input v-model="mapping.variableField" placeholder="字段名" />
                </template>
                <button class="icon-btn danger" type="button" @click="removeMapping(step, mappingIndex)">×</button>
              </div>
            </template>

            <template v-else-if="step.type === 'modifyRecords'">
              <div class="nl-sentence">
                <span>在</span>
                <select
                  class="nl-chip"
                  data-testid="step-modify-sheet"
                  :value="stepSheetId(step)"
                  @change="
                    step.sheetId = ($event.target as HTMLSelectElement).value;
                  "
                >
                  <option value="">选择工作表</option>
                  <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                    {{ sheet.name }}
                  </option>
                </select>
                <span>里，对</span>
                <select
                  v-model="step.fromStepId"
                  class="nl-chip"
                  data-testid="step-target-from"
                  @change="onModifyFromStepChange(step)"
                >
                  <option value="">选择查找步骤</option>
                  <option
                    v-for="candidate in previousFindSteps.filter(
                      (item) => steps.findIndex((stepItem) => stepItem.id === item.id) < index,
                    )"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    {{ findStepOptionLabel(candidate) }}
                  </option>
                </select>
                <span>，修改</span>
                <button
                  class="nl-chip nl-chip-btn"
                  type="button"
                  data-testid="step-open-content"
                  @click="openContentEditor(step)"
                >
                  {{
                    step.mappings.filter((row) => row.fieldId).length
                      ? `指定内容（${step.mappings.filter((row) => row.fieldId).length}）`
                      : '指定内容'
                  }}
                </button>
              </div>
            </template>

            <template v-else-if="step.type === 'sendMessage'">
              <div class="field-block">
                <div class="field-label">发送给</div>
                <div class="recipient-row">
                  <select
                    v-model="step.recipientMode"
                    class="nl-chip"
                    data-testid="step-recipient-mode"
                  >
                    <option value="trigger">触发记录中的人员</option>
                    <option value="fixed">指定成员</option>
                  </select>
                  <template v-if="step.recipientMode === 'trigger'">
                    <span class="recipient-pill" data-testid="step-recipient-pill">
                      {{ recipientPillLabel(step) }}
                    </span>
                    <select
                      v-model="step.recipientField"
                      class="nl-chip"
                      data-testid="step-recipient-field"
                    >
                      <option value="">填写者</option>
                      <option
                        v-for="field in triggerFields.filter((item) => item.type === 'person')"
                        :key="field.id"
                        :value="field.name"
                      >
                        {{ field.name }}
                      </option>
                    </select>
                  </template>
                </div>
                <div v-if="step.recipientMode === 'fixed'" class="member-picker">
                  <label v-for="member in members" :key="member.userId" class="inline-check">
                    <input
                      type="checkbox"
                      :checked="step.userIds.includes(member.userId)"
                      @change="toggleUser(step, member.userId)"
                    />
                    {{ member.account }}
                  </label>
                </div>
              </div>

              <div class="field-block">
                <div class="field-label">消息内容</div>
                <div class="message-composer" data-testid="step-message-preview">
                  <template
                    v-for="(part, partIndex) in messageParts(step.text)"
                    :key="`${part.kind}-${partIndex}`"
                  >
                    <span v-if="part.kind === 'text'" class="msg-plain">{{ part.value }}</span>
                    <span v-else class="var-chip">
                      {{ part.label }}
                      <button
                        type="button"
                        class="var-chip-x"
                        @click.stop="removeMessageVar(step, partIndex)"
                      >
                        ×
                      </button>
                    </span>
                  </template>
                  <input
                    class="msg-tail"
                    data-testid="step-message-text"
                    :value="messageTailByStep[step.id] ?? ''"
                    placeholder="输入消息内容"
                    @input="
                      setMessageTail(
                        step,
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                    @blur="flushMessageTail(step)"
                    @keydown.enter.prevent="flushMessageTail(step)"
                  />
                </div>
                <div v-if="step.buttons.length" class="message-buttons">
                  <div
                    v-for="(button, buttonIndex) in step.buttons"
                    :key="buttonIndex"
                    class="message-button-row"
                  >
                    <span class="btn-pill">{{ button.title }}</span>
                    <span class="muted tiny">{{ button.url }}</span>
                    <button
                      class="icon-btn danger"
                      type="button"
                      @click="removeButton(step, buttonIndex)"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div class="message-toolbar">
                  <div class="toolbar-left">
                    <div class="toolbar-item">
                      <button
                        class="toolbar-btn"
                        type="button"
                        data-testid="message-add-emoji"
                        @click="
                          emojiMenuStepId =
                            emojiMenuStepId === step.id ? '' : step.id;
                          variableMenuStepId = '';
                        "
                      >
                        😊 添加表情
                      </button>
                      <div v-if="emojiMenuStepId === step.id" class="var-popup emoji-popup">
                        <button
                          v-for="emoji in EMOJIS"
                          :key="emoji"
                          type="button"
                          class="emoji-btn"
                          @click="insertEmoji(step, emoji)"
                        >
                          {{ emoji }}
                        </button>
                      </div>
                    </div>
                    <div class="toolbar-item">
                      <button
                        class="toolbar-btn"
                        type="button"
                        data-testid="message-insert-variable"
                        @click="
                          variableMenuStepId =
                            variableMenuStepId === step.id ? '' : step.id;
                          variableMenuGroup = '';
                          emojiMenuStepId = '';
                        "
                      >
                        ƒx 插入变量
                      </button>
                      <div
                        v-if="variableMenuStepId === step.id"
                        class="var-flyout"
                        data-testid="variable-menu"
                      >
                        <div class="var-flyout-main">
                          <button
                            v-for="group in variableMenuGroups(step)"
                            :key="group.label"
                            type="button"
                            class="var-menu-row"
                            :class="{
                              active: variableMenuGroup === group.label,
                            }"
                            @mouseenter="variableMenuGroup = group.label"
                            @click="variableMenuGroup = group.label"
                          >
                            {{ group.label }}
                            <span>›</span>
                          </button>
                        </div>
                        <div
                          v-if="variableMenuGroup"
                          class="var-flyout-sub"
                          data-testid="variable-submenu"
                        >
                          <button
                            v-for="item in variableMenuGroups(step).find(
                              (group) => group.label === variableMenuGroup,
                            )?.items ?? []"
                            :key="item.token"
                            type="button"
                            class="var-menu-row"
                            @click="insertVariableToken(step, item.token)"
                          >
                            {{ item.label }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    class="toolbar-btn"
                    type="button"
                    data-testid="message-add-button"
                    @click="openButtonDraft(step)"
                  >
                    + 添加按钮
                  </button>
                </div>
              </div>
            </template>

            <template v-else-if="step.type === 'sendHttp'">
              <div class="nl-sentence">
                <span>请求方法</span>
                <select
                  v-model="step.httpMethod"
                  class="nl-chip"
                  data-testid="step-http-method"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <label class="form-field">
                <span>请求 URL</span>
                <input
                  v-model="step.httpUrl"
                  data-testid="step-http-url"
                  placeholder="https://example.com/hook?code={{序列号}}"
                />
              </label>
              <label class="form-field">
                <span>请求头（JSON 对象，可选）</span>
                <textarea
                  v-model="step.httpHeadersJson"
                  data-testid="step-http-headers"
                  rows="3"
                  placeholder='{"Content-Type":"application/json"}'
                />
              </label>
              <label
                v-if="step.httpMethod !== 'GET' && step.httpMethod !== 'DELETE'"
                class="form-field"
              >
                <span>请求体（可插入 <code v-pre>{{变量}}</code>）</span>
                <textarea
                  v-model="step.httpBody"
                  data-testid="step-http-body"
                  rows="4"
                  placeholder='{"serial":"{{第3步.序列号}}"}'
                />
              </label>
              <label class="form-field">
                <span>超时（毫秒）</span>
                <input
                  v-model.number="step.httpTimeoutMs"
                  type="number"
                  min="1000"
                  max="60000"
                  data-testid="step-http-timeout"
                />
              </label>
            </template>

            <template v-else-if="step.type === 'condition'">
              <div class="nl-sentence">
                <span>对照</span>
                <select
                  v-model="step.conditionSource"
                  class="nl-chip"
                  data-testid="step-condition-source"
                >
                  <option value="trigger">触发记录</option>
                  <option
                    v-for="prior in previousRecordSteps"
                    :key="prior.id"
                    :value="prior.id"
                  >
                    {{
                      prior.type === 'findRecords'
                        ? '查找'
                        : prior.type === 'createRecord'
                          ? '创建'
                          : '修改'
                    }}步骤「{{ prior.name || prior.id.slice(0, 6) }}」
                  </option>
                </select>
              </div>
              <div class="nl-sentence">
                <span>满足以下</span>
                <select v-model="step.filterConjunction" class="nl-chip">
                  <option value="and">全部</option>
                  <option value="or">任意</option>
                </select>
                <span>条件，否则跳过后续步骤</span>
              </div>
              <div
                v-for="(filter, filterIndex) in step.filterRows"
                :key="filterIndex"
                class="nl-sentence"
              >
                <select v-model="filter.fieldId" class="nl-chip">
                  <option value="">选择字段</option>
                  <option
                    v-for="field in sheetFields(
                      step.conditionSource === 'trigger'
                        ? triggerSheetIdForFields
                        : steps.find((item) => item.id === step.conditionSource)
                            ?.sheetId || triggerSheetIdForFields,
                    )"
                    :key="field.id"
                    :value="field.id"
                  >
                    {{ field.name }}
                  </option>
                </select>
                <select v-model="filter.operator" class="nl-chip">
                  <option value="equals">等于</option>
                  <option value="notEquals">不等于</option>
                  <option value="contains">包含</option>
                  <option value="isEmpty">为空</option>
                  <option value="isNotEmpty">不为空</option>
                </select>
                <select
                  v-if="
                    filter.operator !== 'isEmpty' &&
                    filter.operator !== 'isNotEmpty' &&
                    fieldChoices(
                      step.conditionSource === 'trigger'
                        ? triggerSheetIdForFields
                        : steps.find((item) => item.id === step.conditionSource)
                            ?.sheetId || triggerSheetIdForFields,
                      filter.fieldId,
                    ).length
                  "
                  v-model="filter.value"
                  class="nl-chip"
                  data-testid="step-condition-choice"
                >
                  <option value="">选择选项</option>
                  <option
                    v-for="choice in fieldChoices(
                      step.conditionSource === 'trigger'
                        ? triggerSheetIdForFields
                        : steps.find((item) => item.id === step.conditionSource)
                            ?.sheetId || triggerSheetIdForFields,
                      filter.fieldId,
                    )"
                    :key="choice.id"
                    :value="choice.id"
                  >
                    {{ choice.name }}
                  </option>
                </select>
                <input
                  v-else-if="
                    filter.operator !== 'isEmpty' &&
                    filter.operator !== 'isNotEmpty'
                  "
                  v-model="filter.value"
                  class="nl-chip nl-chip-input"
                  placeholder="值"
                  data-testid="step-condition-value"
                />
              </div>
              <button
                class="nl-add-link"
                type="button"
                @click="
                  step.filterRows.push({
                    fieldId: '',
                    operator: 'equals',
                    value: '',
                  })
                "
              >
                + 添加条件
              </button>
            </template>

            <template v-else-if="step.type === 'delay'">
              <div class="nl-sentence">
                <span>等待</span>
                <input
                  v-model.number="step.delaySeconds"
                  class="nl-chip nl-chip-input"
                  type="number"
                  min="1"
                  max="86400"
                  data-testid="step-delay-seconds"
                />
                <span>秒后继续执行后续步骤</span>
              </div>
            </template>
          </div>
        </article>
          </div>
        </div>

        <div class="add-op-row">
          <div class="add-step-wrap">
            <button
              class="nl-add-link"
              data-testid="automation-add-step"
              type="button"
              @click="addStepOpen = !addStepOpen; typeMenuStepId = ''"
            >
              + 添加操作
            </button>
            <Transition name="menu-fade">
              <div v-if="addStepOpen" class="add-step-menu">
                <button
                  v-for="item in stepTypes"
                  :key="item.value"
                  type="button"
                  :data-testid="`add-step-${item.value}`"
                  @click="addStep(item.value)"
                >
                  <span
                    class="type-badge small"
                    :style="{ background: item.color }"
                  >{{ item.icon }}</span>
                  {{ item.label }}
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </section>

      <footer class="editor-footer">
        <button class="btn" type="button" data-testid="automation-save" :disabled="saving" @click="save('draft')">
          {{ saving ? '保存中…' : '仅保存' }}
        </button>
        <button
          class="btn btn-primary"
          type="button"
          data-testid="automation-save-enable"
          :disabled="saving"
          @click="save('enable')"
        >
          {{ saving ? '保存中…' : '保存并启用' }}
        </button>
      </footer>

      <!-- 查找：满足条件弹层 -->
      <div
        v-if="filterEditorStep()"
        class="button-draft-mask"
        data-testid="filter-editor-dialog"
        @click.self="closeFilterEditor"
      >
        <div class="content-editor-card">
          <header class="content-editor-head">
            <h4>满足条件的记录</h4>
            <button class="icon-btn" type="button" @click="closeFilterEditor">×</button>
          </header>
          <div class="nl-sentence">
            <span>满足以下</span>
            <select
              v-model="filterEditorStep()!.filterConjunction"
              class="nl-chip"
              data-testid="step-filter-conjunction"
            >
              <option value="and">全部</option>
              <option value="or">任意</option>
            </select>
            <span>条件</span>
          </div>
          <div
            v-for="(filter, index) in filterEditorStep()!.filterRows"
            :key="index"
            class="mapping-row"
            data-testid="step-filter-row"
          >
            <span class="muted">{{
              index === 0
                ? '当'
                : filterEditorStep()!.filterConjunction === 'or'
                  ? '或者'
                  : '并且'
            }}</span>
            <select
              v-model="filter.fieldId"
              data-testid="step-filter-field"
            >
              <option value="">不筛选</option>
              <option
                v-for="field in fieldOptions(filterEditorStep()!.sheetId)"
                :key="field.id"
                :value="field.id"
              >
                {{ field.name }}
              </option>
            </select>
            <select
              v-if="filter.fieldId"
              v-model="filter.operator"
              data-testid="step-filter-operator"
            >
              <option value="equals">等于</option>
              <option value="notEquals">不等于</option>
              <option value="contains">包含</option>
              <option value="notContains">不包含</option>
              <option value="isEmpty">为空</option>
              <option value="isNotEmpty">不为空</option>
            </select>
            <select
              v-if="
                filter.fieldId &&
                filter.operator !== 'isEmpty' &&
                filter.operator !== 'isNotEmpty' &&
                fieldChoices(filterEditorStep()!.sheetId, filter.fieldId).length
              "
              v-model="filter.value"
              data-testid="step-filter-value"
            >
              <option value="">选择选项</option>
              <option
                v-for="choice in fieldChoices(
                  filterEditorStep()!.sheetId,
                  filter.fieldId,
                )"
                :key="choice.id"
                :value="choice.id"
              >
                {{ choice.name }}
              </option>
            </select>
            <input
              v-else-if="
                filter.fieldId &&
                filter.operator !== 'isEmpty' &&
                filter.operator !== 'isNotEmpty'
              "
              v-model="filter.value"
              data-testid="step-filter-value"
              placeholder="值"
            />
            <button
              class="icon-btn danger"
              type="button"
              title="移除条件"
              @click="removeFindFilterRow(filterEditorStep()!, index)"
            >
              ×
            </button>
          </div>
          <button
            class="nl-add-link"
            type="button"
            data-testid="step-add-filter"
            @click="addFindFilterRow(filterEditorStep()!)"
          >
            + 添加条件
          </button>
          <label class="form-field" style="margin-top: 12px">
            <span>最多查找条数</span>
            <input
              v-model.number="filterEditorStep()!.limit"
              type="number"
              min="1"
              data-testid="step-filter-limit"
            />
          </label>
          <footer class="content-editor-footer">
            <button class="btn btn-primary" type="button" @click="closeFilterEditor">
              完成
            </button>
          </footer>
        </div>
      </div>

      <!-- 修改：指定内容弹层 -->
      <div
        v-if="contentEditorStep()"
        class="button-draft-mask"
        data-testid="content-editor-dialog"
        @click.self="closeContentEditor"
      >
        <div class="content-editor-card">
          <header class="content-editor-head">
            <h4>指定内容</h4>
            <button class="icon-btn" type="button" @click="closeContentEditor">×</button>
          </header>
          <div class="mapping-head">
            <span>将字段修改为</span>
            <button
              class="btn small"
              type="button"
              data-testid="content-add-field"
              @click="addMapping(contentEditorStep()!)"
            >
              + 字段
            </button>
          </div>
          <div
            v-for="(mapping, mappingIndex) in contentEditorStep()!.mappings"
            :key="mappingIndex"
            class="mapping-row"
          >
            <select v-model="mapping.fieldId">
              <option value="">选择字段</option>
              <option
                v-for="field in fieldOptions(stepSheetId(contentEditorStep()!))"
                :key="field.id"
                :value="field.id"
              >
                {{ field.name }}
              </option>
            </select>
            <select v-model="mapping.mode">
              <option value="literal">固定值</option>
              <option value="variable">变量</option>
            </select>
            <select
              v-if="
                mapping.mode === 'literal' &&
                fieldChoices(
                  stepSheetId(contentEditorStep()!),
                  mapping.fieldId,
                ).length
              "
              v-model="mapping.value"
            >
              <option value="">选择选项</option>
              <option
                v-for="choice in fieldChoices(
                  stepSheetId(contentEditorStep()!),
                  mapping.fieldId,
                )"
                :key="choice.id"
                :value="choice.id"
              >
                {{ choice.name }}
              </option>
            </select>
            <input
              v-else-if="mapping.mode === 'literal'"
              v-model="mapping.value"
              placeholder="值"
            />
            <template v-else>
              <select v-model="mapping.variableSource">
                <option value="trigger">触发记录</option>
                <option value="step">前序步骤</option>
              </select>
              <input v-model="mapping.variableField" placeholder="字段名" />
            </template>
            <button
              class="icon-btn danger"
              type="button"
              @click="removeMapping(contentEditorStep()!, mappingIndex)"
            >
              ×
            </button>
          </div>
          <footer class="content-editor-footer">
            <button class="btn btn-primary" type="button" @click="closeContentEditor">
              完成
            </button>
          </footer>
        </div>
      </div>

      <div
        v-if="buttonDraft"
        class="button-draft-mask"
        data-testid="message-button-dialog"
        @click.self="buttonDraft = null"
      >
        <div class="button-draft-card">
          <h4>添加按钮</h4>
          <label class="ai-label">按钮标题</label>
          <input
            v-model="buttonDraft.title"
            data-testid="message-button-title"
            placeholder="输入文本"
          />
          <label class="ai-label">按钮链接</label>
          <input
            v-model="buttonDraft.url"
            data-testid="message-button-url"
            placeholder="粘贴链接"
          />
          <footer>
            <button class="btn" type="button" @click="buttonDraft = null">取消</button>
            <button
              class="btn btn-primary"
              type="button"
              data-testid="message-button-confirm"
              @click="confirmButton"
            >
              确定
            </button>
          </footer>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.automation-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
  padding: 12px 16px;
  background: var(--bg-muted, #f7f8fa);
  border-radius: 12px;
}
.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.editor-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.editor-title-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
}
.editor-title-input:hover,
.editor-title-input:focus {
  border-color: #d0d5dd;
  background: #fff;
  outline: none;
}
.editor-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.quota-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #667085;
}
.quota-inline input {
  width: 72px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  font-size: 12px;
}
.nl-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nl-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.nl-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1d2129;
}
.timeline-block {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.timeline-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 16px;
  padding-top: 6px;
}
.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #2d8cf0;
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.18);
  flex-shrink: 0;
}
.timeline-line {
  flex: 1;
  width: 2px;
  margin-top: 4px;
  background: #d6e4ff;
  min-height: 24px;
}
.timeline-main {
  flex: 1;
  min-width: 0;
}
.timeline-step-no {
  margin-bottom: 6px;
  font-size: 12px;
  color: #8f959e;
}
.nl-card {
  padding: 14px 16px;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.nl-card:hover {
  border-color: #c7d7f5;
}
.nl-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.nl-card-actions {
  display: flex;
  gap: 2px;
}
.type-picker {
  position: relative;
}
.type-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 4px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.type-trigger:hover {
  border-color: #91caff;
  background: #f7faff;
}
.type-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.type-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
}
.type-badge.small {
  width: 20px;
  height: 20px;
  font-size: 11px;
}
.chevron {
  color: #8f959e;
  font-size: 10px;
}
.type-menu .check {
  margin-left: auto;
  color: #1d6fdc;
}
.add-op-row {
  margin-top: 4px;
  padding-left: 26px;
}
.btn.ghost.small {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dee0e3;
  background: #fff;
  font-size: 12px;
}
.nl-step-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary, #8f959e);
}
.nl-sentence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-top: 8px;
  font-size: 13px;
  color: #344054;
  line-height: 1.6;
}
.nl-chip,
.nl-chip-input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-strong, #d0d3d6);
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font-size: 13px;
  font-family: inherit;
  max-width: 220px;
}
.nl-chip-input {
  min-width: 88px;
}
.nl-chip-num {
  width: 64px;
  max-width: 64px;
  text-align: center;
}
.nl-filters {
  margin-top: 4px;
}
.nl-add-link {
  margin-top: 10px;
  padding: 0;
  border: none;
  background: transparent;
  color: #1d6fdc;
  font-size: 13px;
  cursor: pointer;
}
.nl-hint {
  margin: 12px -16px -14px;
  padding: 10px 16px;
  border-radius: 0 0 12px 12px;
  background: #f5f6f7;
  color: var(--text-secondary, #646a73);
  font-size: 12px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #475467;
}
.form-field input,
.form-field select,
.step-body textarea,
.mapping-row select,
.mapping-row input {
  height: 32px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid #d0d5dd;
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  font-family: inherit;
}
.step-body textarea {
  height: auto;
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475467;
}
.mapping-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 8px 0 4px;
  font-size: 12px;
  color: #475467;
}
.mapping-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
.mapping-row select,
.mapping-row input {
  flex: 1;
}
.add-step-wrap {
  position: relative;
}
.add-step-menu {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: 160px;
  padding: 5px;
  border: 1px solid #eaecf0;
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
}
.add-step-menu button {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.add-step-menu button:hover {
  background: #f5f8ff;
}
.empty-steps {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 22px;
  text-align: center;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
  background: #fafbfc;
}
.empty-steps-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #4e5969;
}
.empty-steps-hint {
  margin: 0 0 6px;
  max-width: 320px;
  font-size: 12px;
  line-height: 1.5;
  color: #98a2b3;
}
.step-card {
  margin-top: 0;
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nl-chip-btn {
  cursor: pointer;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.on-empty-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  margin-top: 10px;
  font-size: 13px;
  color: #344054;
}
.on-empty-label {
  color: #667085;
}
.radio-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.field-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.field-label {
  font-size: 13px;
  font-weight: 500;
  color: #344054;
}
.channel-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.channel-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px 12px 36px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  position: relative;
}
.channel-card.active {
  border-color: #1d6fdc;
  background: #f5f9ff;
}
.channel-radio {
  position: absolute;
  left: 12px;
  top: 16px;
  width: 14px;
  height: 14px;
  border: 1.5px solid #c0c4cc;
  border-radius: 50%;
  box-sizing: border-box;
}
.channel-card.active .channel-radio {
  border-color: #1d6fdc;
  background: radial-gradient(circle at center, #1d6fdc 40%, transparent 45%);
}
.channel-title {
  font-size: 13px;
  font-weight: 600;
  color: #1d2129;
}
.channel-desc {
  font-size: 12px;
  color: #98a2b3;
}
.recipient-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.recipient-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: #eef2ff;
  color: #3b5bdb;
  font-size: 12px;
}
.message-composer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 88px;
  padding: 10px 12px;
  border: 1px solid #c7d7f5;
  border-radius: 10px;
  background: #fff;
}
.message-composer:focus-within {
  border-color: #1d6fdc;
  box-shadow: 0 0 0 3px rgba(29, 111, 220, 0.12);
}
.msg-plain {
  font-size: 13px;
  color: #1d2129;
  white-space: pre-wrap;
}
.msg-tail {
  flex: 1;
  min-width: 120px;
  height: 28px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
}
.var-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  background: #e8f3ff;
  color: #1d6fdc;
  font-size: 12px;
  border: 1px solid #d6e4ff;
}
.var-chip-x {
  border: none;
  background: transparent;
  color: #667085;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  border-radius: 4px;
}
.var-chip-x:hover {
  color: #d4380d;
  background: #fff1f0;
}
.member-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px;
  border-radius: 8px;
  background: #f8f9fb;
}
.message-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f5f6f8;
}
.toolbar-left {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.toolbar-item {
  position: relative;
}
.toolbar-btn {
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #475467;
  font-size: 12px;
  cursor: pointer;
}
.toolbar-btn:hover {
  background: #eef0f4;
}
.var-popup,
.var-flyout {
  position: absolute;
  bottom: 34px;
  left: 0;
  z-index: 40;
  border: 1px solid #eaecf0;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}
.var-popup {
  min-width: 200px;
  max-height: 260px;
  overflow: auto;
  padding: 6px;
}
.var-flyout {
  display: flex;
  align-items: stretch;
  padding: 0;
  overflow: visible;
}
.var-flyout-main {
  min-width: 180px;
  max-height: 280px;
  overflow: auto;
  padding: 6px;
}
.var-flyout-sub {
  min-width: 160px;
  max-height: 280px;
  overflow: auto;
  padding: 6px;
  border-left: 1px solid #eaecf0;
}
.var-menu-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.var-menu-row:hover,
.var-menu-row.active {
  background: #f5f8ff;
}
.emoji-popup {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 180px;
}
.emoji-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
}
.emoji-btn:hover {
  background: #f5f8ff;
}
.message-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.message-button-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: #e8f3ff;
  color: #1d6fdc;
  font-size: 12px;
}
.button-draft-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.35);
}
.button-draft-card,
.content-editor-card {
  width: min(480px, 92vw);
  padding: 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
}
.button-draft-card h4,
.content-editor-head h4 {
  margin: 0 0 10px;
  font-size: 15px;
}
.content-editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.content-editor-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.button-draft-card input {
  width: 100%;
  box-sizing: border-box;
  height: 34px;
  margin-bottom: 10px;
  padding: 0 10px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
}
.button-draft-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.ai-label {
  display: block;
  margin: 0 0 4px;
  font-size: 12px;
  color: #667085;
}
.editor-error {
  color: #d92d20;
  font-size: 12px;
  margin: 0;
}
.editor-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 12px 0 4px;
  border-top: 1px solid #eaecf0;
  background: #fff;
}
.icon-btn.danger {
  color: #d4380d;
}
.muted {
  color: #667085;
}
.tiny {
  font-size: 11px;
}
</style>
