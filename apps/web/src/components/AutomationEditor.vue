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

const props = defineProps<{
  baseId: string;
  automation: AutomationDto | null;
}>();
const emit = defineEmits<{
  close: [];
  saved: [automation: AutomationDto];
}>();

type StepType =
  | 'findRecords'
  | 'createRecord'
  | 'modifyRecords'
  | 'sendMessage'
  | 'startGroupChat'
  | 'addGroupMembers';

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
  filterFieldId: string;
  filterOperator: string;
  filterValue: string;
  /** Find-step filter conjunction (企微：满足任意/全部条件). */
  filterConjunction: 'and' | 'or';
  fromStepId: string;
  mappings: MappingRow[];
  channel: 'doc' | 'group';
  groupChatId: string;
  text: string;
  recipientMode: 'trigger' | 'fixed';
  recipientField: string;
  userIds: string[];
  memberUserIds: string[];
  memberUserIdsText: string;
}

const sheets = ref<SheetDto[]>([]);
const members = ref<MemberDto[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const name = ref('');
const enabled = ref(false);
const triggerType = ref<'recordCreated' | 'recordUpdated' | 'schedule'>(
  'recordCreated',
);
const triggerSheetId = ref('');
const triggerFilters = ref<
  Array<{ fieldId: string; operator: string; value: string }>
>([{ fieldId: '', operator: 'equals', value: '' }]);
const triggerConjunction = ref<'and' | 'or'>('and');
const cron = ref('0 9 * * *');
const timezone = ref('Asia/Shanghai');
const onFindEmpty = ref<'continue' | 'stop'>('continue');
const monthlyQuota = ref<number | null>(null);
const steps = ref<UiStep[]>([]);
const addStepOpen = ref(false);

const stepTypes: Array<{ value: StepType; label: string; icon: string }> = [
  { value: 'findRecords', label: '查找记录', icon: '🔍' },
  { value: 'createRecord', label: '新增记录', icon: '➕' },
  { value: 'modifyRecords', label: '修改记录', icon: '✏️' },
  { value: 'sendMessage', label: '发送消息', icon: '💬' },
  { value: 'startGroupChat', label: '创建群聊', icon: '👥' },
  { value: 'addGroupMembers', label: '添加群成员', icon: '🙋' },
];

const triggerFields = computed(() =>
  sheetFields(triggerSheetId.value),
);
const triggerSheet = computed(() =>
  sheets.value.find((sheet) => sheet.id === triggerSheetId.value),
);
const previousFindSteps = computed(() =>
  steps.value.filter((step) => step.type === 'findRecords'),
);

function sheetFields(sheetId: string): FieldDto[] {
  return sheets.value.find((sheet) => sheet.id === sheetId)?.fields ?? [];
}

function fieldName(sheetId: string, fieldId: string): string {
  return sheetFields(sheetId).find((field) => field.id === fieldId)?.name ?? fieldId;
}

function errorOf(value: unknown): string {
  return value instanceof ApiError ? value.message : '自动化保存失败';
}

function blankStep(type: StepType): UiStep {
  return {
    id: crypto.randomUUID(),
    type,
    name: '',
    sheetId: sheets.value[0]?.id ?? '',
    limit: 1,
    onEmpty: 'continue',
    filterFieldId: '',
    filterOperator: 'equals',
    filterValue: '',
    filterConjunction: 'and',
    fromStepId: '',
    mappings: [],
    channel: 'doc',
    groupChatId: '',
    text: '',
    recipientMode: 'trigger',
    recipientField: '',
    userIds: [],
    memberUserIds: [],
    memberUserIdsText: '',
  };
}

function addStep(type: StepType): void {
  const step = blankStep(type);
  if (type === 'modifyRecords') {
    step.fromStepId = previousFindSteps.value.at(-1)?.id ?? '';
  }
  steps.value = [...steps.value, step];
  addStepOpen.value = false;
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
  const when =
    triggerType.value === 'recordUpdated' ? '记录被更新时' : '新增记录时';
  const sheet = sheetLabel(triggerSheetId.value);
  const conditions = triggerFilters.value
    .filter((row) => row.fieldId)
    .map((row) => {
      const field = fieldName(triggerSheetId.value, row.fieldId);
      if (row.operator === 'isEmpty' || row.operator === 'isNotEmpty') {
        return `${field}${operatorLabel(row.operator)}`;
      }
      return `${field}${operatorLabel(row.operator)}「${row.value || '…'}」`;
    });
  if (conditions.length === 0) {
    return `当「${sheet}」${when}`;
  }
  return `当「${sheet}」${when}，且 ${conditions.join('，')}`;
}

function stepSummary(step: UiStep): string {
  switch (step.type) {
    case 'findRecords': {
      const sheet = sheetLabel(step.sheetId);
      if (!step.filterFieldId) {
        return `在「${sheet}」中查找最多 ${step.limit} 条记录`;
      }
      const field = fieldName(step.sheetId, step.filterFieldId);
      const cond =
        step.filterOperator === 'isEmpty' ||
        step.filterOperator === 'isNotEmpty'
          ? `${field}${operatorLabel(step.filterOperator)}`
          : `${field}${operatorLabel(step.filterOperator)}「${step.filterValue || '…'}」`;
      return `在「${sheet}」中查找 ${cond} 的记录（最多 ${step.limit} 条）`;
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
    case 'startGroupChat':
      return step.name
        ? `创建群聊「${step.name}」`
        : '创建群聊';
    case 'addGroupMembers':
      return `向群聊添加 ${step.memberUserIds.length || '若干'} 名成员`;
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
}

function fieldOptions(sheetId: string): FieldDto[] {
  return sheetFields(sheetId);
}

function variableFieldsFor(step: UiStep): string[] {
  const targetSheetId = stepSheetId(step);
  const names = new Set<string>();
  for (const field of triggerFields.value) names.add(field.name);
  for (const field of sheetFields(targetSheetId)) names.add(field.name);
  // Include earlier find-step sheet fields.
  for (const candidate of steps.value) {
    if (candidate.id === step.id) break;
    for (const field of sheetFields(stepSheetId(candidate))) {
      names.add(field.name);
    }
  }
  return [...names];
}

function insertVariable(step: UiStep, field: string): void {
  step.text = `${step.text}{{${field}}}`;
}

function memberName(userId: string): string {
  return members.value.find((member) => member.userId === userId)?.name ?? userId;
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
          filters: buildFilter(
            [
              {
                fieldId: step.filterFieldId,
                operator: step.filterOperator,
                value: step.filterValue,
              },
            ],
            step.filterConjunction,
          ),
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
      case 'sendMessage':
        return {
          id: step.id,
          type: step.type,
          channel: 'doc',
          recipients:
            step.recipientMode === 'fixed'
              ? [{ source: 'fixed', userIds: step.userIds }]
              : [{ source: 'trigger', field: step.recipientField }],
          content: { text: step.text },
        };
      case 'startGroupChat':
        return {
          id: step.id,
          type: step.type,
          name: step.name,
          memberUserIds: step.memberUserIds,
        };
      case 'addGroupMembers':
        return {
          id: step.id,
          type: step.type,
          fromStepId: step.fromStepId || undefined,
          groupChatId: step.groupChatId || undefined,
          memberUserIds: step.memberUserIds,
        };
      default:
        return { id: step.id, type: step.type };
    }
  });
}

function validate(): string {
  if (!name.value.trim()) return '请输入自动化名称';
  if (triggerType.value !== 'schedule' && !triggerSheetId.value) {
    return '请选择触发工作表';
  }
  if (triggerType.value === 'schedule' && !cron.value.trim()) {
    return '请输入 cron 表达式';
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
    if (step.type === 'sendMessage' && !step.text.trim()) {
      return `第 ${index + 1} 步消息内容不能为空`;
    }
    if (step.type === 'startGroupChat' && !step.name.trim()) {
      return `第 ${index + 1} 步群聊名称不能为空`;
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
  step.id = String(raw.id ?? crypto.randomUUID());
  step.name = String(raw.name ?? `步骤 ${index + 1}`);
  step.sheetId = String(raw.sheetId ?? '');
  step.limit = Number(raw.limit ?? 1) || 1;
  step.onEmpty = raw.onEmpty === 'stop' ? 'stop' : 'continue';
  const filters = raw.filters as
    | {
        conjunction?: 'and' | 'or';
        conditions?: Array<{ fieldId?: string; operator?: string; value?: unknown }>;
      }
    | undefined;
  const firstFilter = filters?.conditions?.[0];
  step.filterFieldId = firstFilter?.fieldId ?? '';
  step.filterOperator = firstFilter?.operator ?? 'equals';
  step.filterValue =
    firstFilter?.value === undefined ? '' : String(firstFilter.value);
  step.filterConjunction = filters?.conjunction === 'or' ? 'or' : 'and';
  const target = raw.target as { stepId?: string } | undefined;
  step.fromStepId = String(raw.fromStepId ?? target?.stepId ?? '');
  const content = raw.content as { text?: string } | undefined;
  step.text = content?.text ?? '';
  step.channel = String(raw.channel ?? 'doc') === 'group' ? 'group' : 'doc';
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
  step.groupChatId = String(raw.groupChatId ?? '');
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
  return step;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const sheetList = await endpoints.listSheets(props.baseId);
    sheets.value = await Promise.all(
      sheetList.map((sheet) => endpoints.getSheet(sheet.id)),
    );
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
      enabled.value = false;
      return;
    }
    name.value =
      typedDuringLoad && typedDuringLoad !== automation.name
        ? typedDuringLoad
        : automation.name;
    enabled.value = automation.enabled;
    const trigger = automation.trigger as Record<string, unknown>;
    triggerType.value =
      trigger.type === 'schedule'
        ? 'schedule'
        : trigger.type === 'recordUpdated'
          ? 'recordUpdated'
          : 'recordCreated';
    triggerSheetId.value = String(trigger.sheetId ?? triggerSheetCandidate);
    cron.value = String(trigger.cron ?? '0 9 * * *');
    timezone.value = String(trigger.timezone ?? 'Asia/Shanghai');
    const filters = trigger.filters as
      | {
          conjunction?: 'and' | 'or';
          conditions?: Array<{ fieldId?: string; operator?: string; value?: unknown }>;
        }
      | undefined;
    triggerConjunction.value = filters?.conjunction === 'or' ? 'or' : 'and';
    triggerFilters.value =
      filters?.conditions?.length
        ? filters.conditions.map((condition) => ({
            fieldId: condition.fieldId ?? '',
            operator: condition.operator ?? 'equals',
            value:
              condition.value === undefined ? '' : String(condition.value),
          }))
        : [{ fieldId: '', operator: 'equals', value: '' }];
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
        <label class="quota-inline">
          月额度
          <input
            v-model.number="monthlyQuota"
            type="number"
            min="0"
            placeholder="不限"
            data-testid="automation-quota"
          />
        </label>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <p v-if="error" class="editor-error" data-testid="automation-editor-error">{{ error }}</p>

      <section class="nl-section">
        <h4 class="nl-section-title">当满足以下条件</h4>
        <div class="nl-card" data-testid="automation-trigger-card">
          <div class="nl-step-label">第 1 步</div>
          <div class="nl-sentence" data-testid="automation-trigger-summary">
            <select v-model="triggerType" class="nl-chip" data-testid="trigger-type">
              <option value="recordCreated">添加新记录时</option>
              <option value="recordUpdated">更新记录时</option>
              <option value="schedule">定时触发</option>
            </select>
            <template v-if="triggerType !== 'schedule'">
              <span>在</span>
              <select v-model="triggerSheetId" class="nl-chip" data-testid="trigger-sheet">
                <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                  {{ sheet.name }}
                </option>
              </select>
              <span>里{{ triggerType === 'recordCreated' ? '添加新记录' : '更新记录' }}时</span>
            </template>
            <template v-else>
              <span>按</span>
              <input v-model="cron" class="nl-chip nl-chip-input" data-testid="trigger-cron" />
              <select v-model="timezone" class="nl-chip" data-testid="trigger-timezone">
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="UTC">UTC</option>
              </select>
            </template>
          </div>

          <div v-if="triggerType !== 'schedule'" class="nl-filters">
            <div
              v-for="(filter, index) in triggerFilters"
              :key="index"
              class="nl-sentence"
              data-testid="trigger-condition"
            >
              <span>{{ index === 0 ? '且同时满足' : '并且' }}</span>
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
              <input
                v-if="filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty'"
                v-model="filter.value"
                class="nl-chip nl-chip-input"
                placeholder="值"
              />
              <button class="icon-btn danger" type="button" @click="removeTriggerFilter(index)">
                ×
              </button>
            </div>
            <div class="nl-sentence" style="margin-top: 4px">
              <span>条件关系</span>
              <select
                v-model="triggerConjunction"
                class="nl-chip"
                data-testid="trigger-conjunction"
              >
                <option value="and">全部满足</option>
                <option value="or">任意满足</option>
              </select>
            </div>
            <button
              class="nl-add-link"
              type="button"
              data-testid="trigger-add-filter"
              @click="addTriggerFilter"
            >
              + 添加{{ triggerConjunction === 'or' ? '任意' : '同时' }}满足的条件
            </button>
            <p class="nl-hint">
              条件未满足时，不会触发后续操作
            </p>
          </div>
        </div>
      </section>

      <section class="nl-section">
        <div class="nl-section-head">
          <h4 class="nl-section-title">就执行以下操作</h4>
          <div class="add-step-wrap">
            <button
              class="btn btn-primary"
              data-testid="automation-add-step"
              type="button"
              @click="addStepOpen = !addStepOpen"
            >
              + 添加步骤
            </button>
            <div v-if="addStepOpen" class="add-step-menu">
              <button
                v-for="item in stepTypes"
                :key="item.value"
                type="button"
                :data-testid="`add-step-${item.value}`"
                @click="addStep(item.value)"
              >
                <span>{{ item.icon }}</span>{{ item.label }}
              </button>
            </div>
          </div>
        </div>

        <p v-if="steps.length === 0" class="empty-steps">
          还没有操作步骤。点击「添加步骤」开始配置。
        </p>

        <article
          v-for="(step, index) in steps"
          :key="step.id"
          class="nl-card step-card"
          :data-testid="`automation-step-${step.type}`"
        >
          <div class="nl-card-head">
            <div class="nl-step-label">第 {{ index + 2 }} 步 · {{ stepTypeLabel(step.type) }}</div>
            <div class="nl-card-actions">
              <button class="icon-btn" type="button" title="上移" :disabled="index === 0" @click="moveStep(index, -1)">↑</button>
              <button class="icon-btn" type="button" title="下移" :disabled="index === steps.length - 1" @click="moveStep(index, 1)">↓</button>
              <button class="icon-btn danger" type="button" title="删除" @click="removeStep(index)">×</button>
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
                <span>中查找最多</span>
                <input v-model.number="step.limit" class="nl-chip nl-chip-input nl-chip-num" type="number" min="1" />
                <span>条记录</span>
              </div>
              <div class="nl-sentence">
                <span>满足</span>
                <select
                  v-model="step.filterConjunction"
                  class="nl-chip"
                  data-testid="step-filter-conjunction"
                >
                  <option value="and">全部</option>
                  <option value="or">任意</option>
                </select>
                <span>条件</span>
                <select v-model="step.filterFieldId" class="nl-chip" data-testid="step-filter-field">
                  <option value="">不筛选</option>
                  <option v-for="field in fieldOptions(step.sheetId)" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
                <template v-if="step.filterFieldId">
                  <select
                    v-model="step.filterOperator"
                    class="nl-chip"
                    data-testid="step-filter-operator"
                  >
                    <option value="equals">等于</option>
                    <option value="notEquals">不等于</option>
                    <option value="contains">包含</option>
                    <option value="notContains">不包含</option>
                    <option value="isEmpty">为空</option>
                    <option value="isNotEmpty">不为空</option>
                  </select>
                  <input
                    v-if="step.filterOperator !== 'isEmpty' && step.filterOperator !== 'isNotEmpty'"
                    v-model="step.filterValue"
                    class="nl-chip nl-chip-input"
                    data-testid="step-filter-value"
                    placeholder="值"
                  />
                </template>
              </div>
              <div class="nl-sentence">
                <span>未找到时</span>
                <select v-model="step.onEmpty" class="nl-chip">
                  <option value="continue">继续执行</option>
                  <option value="stop">终止</option>
                </select>
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
                <input v-if="mapping.mode === 'literal'" v-model="mapping.value" placeholder="值" />
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
                <span>修改</span>
                <select v-model="step.fromStepId" class="nl-chip" data-testid="step-target-from">
                  <option value="">选择查找步骤</option>
                  <option
                    v-for="candidate in previousFindSteps.filter(
                      (item) => steps.findIndex((stepItem) => stepItem.id === item.id) < index,
                    )"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    第 {{ steps.findIndex((item) => item.id === candidate.id) + 2 }} 步 · 查找记录
                  </option>
                </select>
                <span>找到的记录：</span>
              </div>
              <div class="mapping-head">
                <span>修改字段</span>
                <button class="btn small" type="button" @click="addMapping(step)">+ 字段</button>
              </div>
              <div v-for="(mapping, mappingIndex) in step.mappings" :key="mappingIndex" class="mapping-row">
                <select v-model="mapping.fieldId">
                  <option value="">选择字段</option>
                  <option v-for="field in fieldOptions(stepSheetId(step))" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
                <select v-model="mapping.mode">
                  <option value="literal">固定值</option>
                  <option value="variable">变量</option>
                </select>
                <input v-if="mapping.mode === 'literal'" v-model="mapping.value" placeholder="值" />
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

            <template v-else-if="step.type === 'sendMessage'">
              <div class="nl-sentence">
                <span>向</span>
                <select v-model="step.recipientMode" class="nl-chip" data-testid="step-recipient-mode">
                  <option value="trigger">触发记录中的人员</option>
                  <option value="fixed">指定成员</option>
                </select>
                <template v-if="step.recipientMode === 'trigger'">
                  <select v-model="step.recipientField" class="nl-chip" data-testid="step-recipient-field">
                    <option value="">触发人</option>
                    <option
                      v-for="field in triggerFields.filter((item) => item.type === 'person')"
                      :key="field.id"
                      :value="field.name"
                    >
                      {{ field.name }}
                    </option>
                  </select>
                </template>
                <span>发送消息</span>
              </div>
              <div v-if="step.recipientMode === 'fixed'" class="member-picker">
                <label v-for="member in members" :key="member.userId" class="inline-check">
                  <input
                    type="checkbox"
                    :checked="step.userIds.includes(member.userId)"
                    @change="toggleUser(step, member.userId)"
                  />
                  {{ member.name }}
                </label>
              </div>
              <textarea
                v-model="step.text"
                rows="3"
                placeholder="消息内容，可插入变量"
                data-testid="step-message-text"
              ></textarea>
              <div class="variable-actions">
                <span class="muted tiny">插入变量：</span>
                <button
                  v-for="field in variableFieldsFor(step).slice(0, 8)"
                  :key="field"
                  class="var-chip"
                  type="button"
                  @click="insertVariable(step, field)"
                >
                  {{ field }}
                </button>
              </div>
            </template>

            <template v-else-if="step.type === 'startGroupChat'">
              <div class="nl-sentence">
                <span>创建群聊</span>
                <input v-model="step.name" class="nl-chip nl-chip-input" placeholder="群聊名称" />
              </div>
              <div class="member-picker">
                <label v-for="member in members" :key="member.userId" class="inline-check">
                  <input
                    type="checkbox"
                    :checked="step.memberUserIds.includes(member.userId)"
                    @change="toggleMember(step, member.userId)"
                  />
                  {{ member.name }}
                </label>
              </div>
            </template>

            <template v-else-if="step.type === 'addGroupMembers'">
              <div class="nl-sentence">
                <span>向</span>
                <select v-model="step.fromStepId" class="nl-chip">
                  <option value="">指定群聊 ID</option>
                  <option
                    v-for="candidate in steps.filter((item) => item.type === 'startGroupChat')"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    第 {{ steps.findIndex((item) => item.id === candidate.id) + 2 }} 步 · 创建群聊
                  </option>
                </select>
                <span>添加成员</span>
              </div>
              <label v-if="!step.fromStepId" class="form-field">
                <span>群聊 ID</span>
                <input v-model="step.groupChatId" placeholder="chat id" />
              </label>
              <div class="member-picker">
                <label v-for="member in members" :key="member.userId" class="inline-check">
                  <input
                    type="checkbox"
                    :checked="step.memberUserIds.includes(member.userId)"
                    @change="toggleMember(step, member.userId)"
                  />
                  {{ member.name }}
                </label>
              </div>
            </template>
          </div>
        </article>

        <label class="on-empty-inline">
          查找步骤为空时
          <select v-model="onFindEmpty">
            <option value="continue">继续执行</option>
            <option value="stop">终止流程</option>
          </select>
        </label>
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
    </template>
  </div>
</template>

<style scoped>
.automation-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
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
.nl-card {
  padding: 14px 16px;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
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
.nl-step-label {
  font-size: 12px;
  font-weight: 600;
  color: #1d6fdc;
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
  border: 1px solid #c7d7f5;
  border-radius: 8px;
  background: #f0f7ff;
  color: #1d6fdc;
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
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f0f7ff;
  color: #1d6fdc;
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
  padding: 22px;
  text-align: center;
  color: #98a2b3;
  font-size: 13px;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
}
.step-card {
  margin-top: 0;
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.on-empty-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #667085;
}
.on-empty-inline select {
  height: 28px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
}
.member-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px;
  border-radius: 8px;
  background: #f8f9fb;
}
.variable-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.var-chip {
  height: 24px;
  padding: 0 8px;
  border: 1px solid #d6e4ff;
  border-radius: 999px;
  background: #f5f8ff;
  color: #1d6fdc;
  font-size: 11px;
  cursor: pointer;
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
