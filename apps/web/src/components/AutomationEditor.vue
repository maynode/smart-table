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
const enabled = ref(true);
const triggerType = ref<'recordCreated' | 'recordUpdated' | 'schedule'>(
  'recordCreated',
);
const triggerSheetId = ref('');
const triggerFilters = ref<
  Array<{ fieldId: string; operator: string; value: string }>
>([{ fieldId: '', operator: 'equals', value: '' }]);
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
  return conditions.length
    ? { conjunction: 'and' as const, conditions }
    : undefined;
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
    filters: buildFilter(triggerFilters.value),
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
          filters: buildFilter([
            {
              fieldId: step.filterFieldId,
              operator: step.filterOperator,
              value: step.filterValue,
            },
          ]),
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

async function save(): Promise<void> {
  const validation = validate();
  if (validation) {
    error.value = validation;
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const body = {
      name: name.value.trim(),
      enabled: enabled.value,
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
    | { conditions?: Array<{ fieldId?: string; operator?: string; value?: unknown }> }
    | undefined;
  const firstFilter = filters?.conditions?.[0];
  step.filterFieldId = firstFilter?.fieldId ?? '';
  step.filterOperator = firstFilter?.operator ?? 'equals';
  step.filterValue =
    firstFilter?.value === undefined ? '' : String(firstFilter.value);
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
    triggerSheetId.value = triggerSheetCandidate;

    const automation = props.automation;
    if (!automation) {
      name.value = '新建自动化';
      return;
    }
    name.value = automation.name;
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
      | { conditions?: Array<{ fieldId?: string; operator?: string; value?: unknown }> }
      | undefined;
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
      <div>
        <h3>{{ automation ? '编辑自动化' : '新建自动化' }}</h3>
        <p class="muted">触发 → 查找 → 修改 / 发消息，保存后立即生效。</p>
      </div>
      <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <p v-if="error" class="editor-error" data-testid="automation-editor-error">{{ error }}</p>

      <div class="editor-grid">
        <label class="form-field">
          <span>名称</span>
          <input v-model="name" data-testid="automation-name" maxlength="120" />
        </label>
        <label class="form-field inline">
          <span>启用</span>
          <input v-model="enabled" type="checkbox" data-testid="automation-enabled" />
        </label>
        <label class="form-field">
          <span>月运行额度</span>
          <input
            v-model.number="monthlyQuota"
            type="number"
            min="0"
            placeholder="不限"
            data-testid="automation-quota"
          />
        </label>
      </div>

      <section class="editor-section">
        <header class="section-head">
          <strong>触发条件</strong>
          <span class="section-tag">When</span>
        </header>
        <div class="trigger-grid">
          <label class="form-field">
            <span>触发方式</span>
            <select v-model="triggerType" data-testid="trigger-type">
              <option value="recordCreated">新增记录时</option>
              <option value="recordUpdated">更新记录时</option>
              <option value="schedule">定时触发</option>
            </select>
          </label>
          <label v-if="triggerType !== 'schedule'" class="form-field">
            <span>触发表</span>
            <select v-model="triggerSheetId" data-testid="trigger-sheet">
              <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                {{ sheet.name }}
              </option>
            </select>
          </label>
          <template v-else>
            <label class="form-field">
              <span>cron（分 时 日 月 周）</span>
              <input v-model="cron" data-testid="trigger-cron" />
            </label>
            <label class="form-field">
              <span>时区</span>
              <select v-model="timezone" data-testid="trigger-timezone">
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </label>
          </template>
        </div>

        <div v-if="triggerType !== 'schedule'" class="filter-block">
          <div class="filter-title">
            <span>且记录满足条件（全部满足）</span>
            <button class="btn small" data-testid="trigger-add-filter" @click="addTriggerFilter">
              + 条件
            </button>
          </div>
          <div
            v-for="(filter, index) in triggerFilters"
            :key="index"
            class="condition-row"
            data-testid="trigger-condition"
          >
            <select v-model="filter.fieldId" data-testid="trigger-filter-field">
              <option value="">选择字段</option>
              <option v-for="field in triggerFields" :key="field.id" :value="field.id">
                {{ field.name }}
              </option>
            </select>
            <select v-model="filter.operator">
              <option value="equals">等于</option>
              <option value="notEquals">不等于</option>
              <option value="contains">包含</option>
              <option value="isEmpty">为空</option>
              <option value="isNotEmpty">不为空</option>
              <option value="gt">大于</option>
              <option value="lt">小于</option>
            </select>
            <input
              v-if="filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty'"
              v-model="filter.value"
              placeholder="值"
            />
            <button class="icon-btn danger" @click="removeTriggerFilter(index)">×</button>
          </div>
        </div>
        <p class="muted tiny" v-if="triggerType !== 'schedule'">
          触发记录：{{ triggerSheet?.name ?? '请选择工作表' }}
        </p>
      </section>

      <section class="editor-section">
        <header class="section-head">
          <strong>执行步骤</strong>
          <div class="section-actions">
            <label class="inline-check">
              查找为空
              <select v-model="onFindEmpty">
                <option value="continue">继续执行</option>
                <option value="stop">终止</option>
              </select>
            </label>
            <div class="add-step-wrap">
              <button class="btn btn-primary" data-testid="automation-add-step" @click="addStepOpen = !addStepOpen">
                + 添加步骤
              </button>
              <div v-if="addStepOpen" class="add-step-menu">
                <button
                  v-for="item in stepTypes"
                  :key="item.value"
                  :data-testid="`add-step-${item.value}`"
                  @click="addStep(item.value)"
                >
                  <span>{{ item.icon }}</span>{{ item.label }}
                </button>
              </div>
            </div>
          </div>
        </header>

        <p v-if="steps.length === 0" class="empty-steps">
          还没有步骤。点击右上角「添加步骤」开始。
        </p>

        <article
          v-for="(step, index) in steps"
          :key="step.id"
          class="step-card"
          :data-testid="`automation-step-${step.type}`"
        >
          <header class="step-head">
            <span class="step-index">{{ index + 1 }}</span>
            <span class="step-icon">{{ stepTypeIcon(step.type) }}</span>
            <strong>{{ stepTypeLabel(step.type) }}</strong>
            <span class="step-id">{{ step.id.slice(0, 8) }}</span>
            <span class="step-spacer"></span>
            <button class="icon-btn" title="上移" :disabled="index === 0" @click="moveStep(index, -1)">↑</button>
            <button class="icon-btn" title="下移" :disabled="index === steps.length - 1" @click="moveStep(index, 1)">↓</button>
            <button class="icon-btn danger" title="删除步骤" @click="removeStep(index)">×</button>
          </header>

          <div class="step-body">
            <template v-if="step.type === 'findRecords'">
              <div class="step-grid">
                <label class="form-field">
                  <span>在表中查找</span>
                  <select v-model="step.sheetId" data-testid="step-sheet">
                    <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                      {{ sheet.name }}
                    </option>
                  </select>
                </label>
                <label class="form-field">
                  <span>最多返回</span>
                  <input v-model.number="step.limit" type="number" min="1" />
                </label>
                <label class="form-field">
                  <span>未找到时</span>
                  <select v-model="step.onEmpty">
                    <option value="continue">继续执行</option>
                    <option value="stop">终止</option>
                  </select>
                </label>
              </div>
              <div class="condition-row">
                <select v-model="step.filterFieldId" data-testid="step-filter-field">
                  <option value="">筛选字段（可选）</option>
                  <option v-for="field in fieldOptions(step.sheetId)" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option>
                </select>
                <select v-model="step.filterOperator">
                  <option value="equals">等于</option>
                  <option value="notEquals">不等于</option>
                  <option value="contains">包含</option>
                  <option value="isEmpty">为空</option>
                  <option value="isNotEmpty">不为空</option>
                </select>
                <input v-model="step.filterValue" placeholder="值" />
              </div>
              <p class="muted tiny">默认只返回 1 条，避免企业微信默认 1 条的隐藏坑。</p>
            </template>

            <template v-else-if="step.type === 'createRecord'">
              <label class="form-field">
                <span>目标表</span>
                <select v-model="step.sheetId" data-testid="step-sheet">
                  <option v-for="sheet in sheets" :key="sheet.id" :value="sheet.id">
                    {{ sheet.name }}
                  </option>
                </select>
              </label>
              <div class="mapping-head">
                <span>字段写入</span>
                <button class="btn small" @click="addMapping(step)">+ 字段</button>
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
                  <input v-model="mapping.variableField" placeholder="字段名，如 序列号" />
                </template>
                <button class="icon-btn danger" @click="removeMapping(step, mappingIndex)">×</button>
              </div>
            </template>

            <template v-else-if="step.type === 'modifyRecords'">
              <label class="form-field">
                <span>修改哪条记录（绑定前序查找步骤）</span>
                <select v-model="step.fromStepId" data-testid="step-target-from">
                  <option value="">选择查找步骤</option>
                  <option
                    v-for="candidate in previousFindSteps.filter(
                      (item) => steps.findIndex((stepItem) => stepItem.id === item.id) < index,
                    )"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    第 {{ steps.findIndex((item) => item.id === candidate.id) + 1 }} 步 · 查找记录
                  </option>
                </select>
              </label>
              <p class="muted tiny">目标表：{{ sheetFields(stepSheetId(step) || '').length ? sheets.find((sheet) => sheet.id === stepSheetId(step))?.name : '未绑定' }}</p>
              <div class="mapping-head">
                <span>修改字段</span>
                <button class="btn small" @click="addMapping(step)">+ 字段</button>
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
                <button class="icon-btn danger" @click="removeMapping(step, mappingIndex)">×</button>
              </div>
            </template>

            <template v-else-if="step.type === 'sendMessage'">
              <div class="step-grid">
                <label class="form-field">
                  <span>发送方式</span>
                  <select disabled>
                    <option>应用消息（文档通知）</option>
                  </select>
                </label>
                <label class="form-field">
                  <span>接收人</span>
                  <select v-model="step.recipientMode" data-testid="step-recipient-mode">
                    <option value="trigger">触发记录中的人员字段</option>
                    <option value="fixed">指定工作区成员</option>
                  </select>
                </label>
                <label v-if="step.recipientMode === 'trigger'" class="form-field">
                  <span>人员字段</span>
                  <select v-model="step.recipientField" data-testid="step-recipient-field">
                    <option value="">触发人 / 记录创建者</option>
                    <option
                      v-for="field in triggerFields.filter((item) => item.type === 'person')"
                      :key="field.id"
                      :value="field.name"
                    >
                      {{ field.name }}
                    </option>
                  </select>
                </label>
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
                  @click="insertVariable(step, field)"
                >
                  {{ field }}
                </button>
              </div>
            </template>

            <template v-else-if="step.type === 'startGroupChat'">
              <label class="form-field">
                <span>群聊名称</span>
                <input v-model="step.name" placeholder="例如：领取通知群" />
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
              <p class="muted tiny">已选择 {{ step.memberUserIds.length }} 人；企业微信凭据缺失时使用本地群聊。</p>
            </template>

            <template v-else-if="step.type === 'addGroupMembers'">
              <label class="form-field">
                <span>群聊来源</span>
                <select v-model="step.fromStepId">
                  <option value="">使用群聊 ID</option>
                  <option
                    v-for="candidate in steps.filter((item) => item.type === 'startGroupChat')"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    第 {{ steps.findIndex((item) => item.id === candidate.id) + 1 }} 步 · 创建群聊
                  </option>
                </select>
              </label>
              <label v-if="!step.fromStepId" class="form-field">
                <span>群聊 ID</span>
                <input v-model="step.groupChatId" placeholder="wecom chat id" />
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
      </section>

      <footer class="editor-footer">
        <p class="muted tiny" v-if="steps.length">
          保存后共 {{ steps.length }} 步；变量以 <code v-pre>{{字段名}}</code> 插入。
        </p>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" data-testid="automation-save" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存自动化' }}
        </button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.automation-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.editor-head h3 {
  margin: 0 0 4px;
}
.editor-head p {
  margin: 0;
  font-size: 12px;
}
.editor-grid,
.step-grid,
.trigger-grid {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr 0.9fr;
  gap: 10px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #475467;
}
.form-field.inline {
  flex-direction: row;
  align-items: center;
}
.form-field input,
.form-field select,
.step-body textarea,
.condition-row select,
.condition-row input,
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
.editor-section {
  padding: 14px;
  border: 1px solid #eaecf0;
  border-radius: 11px;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.section-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef4ff;
  color: #1d6fdc;
  font-size: 10px;
}
.section-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475467;
}
.inline-check select {
  height: 28px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
}
.filter-block {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  background: #f8f9fb;
}
.filter-title,
.mapping-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: #475467;
}
.condition-row,
.mapping-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
.condition-row select,
.condition-row input,
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
  padding: 18px;
  text-align: center;
  color: #98a2b3;
  font-size: 12px;
}
.step-card {
  margin-top: 10px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  overflow: hidden;
}
.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #f8f9fb;
  border-bottom: 1px solid #eef0f3;
}
.step-index {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #2d8cf0;
  color: #fff;
  font-size: 11px;
}
.step-icon {
  font-size: 14px;
}
.step-id {
  color: #98a2b3;
  font-size: 10px;
  font-family: ui-monospace, Menlo, monospace;
}
.step-spacer {
  flex: 1;
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
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
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid #eaecf0;
}
.editor-footer p {
  flex: 1;
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
@media (max-width: 800px) {
  .editor-grid,
  .step-grid,
  .trigger-grid {
    grid-template-columns: 1fr;
  }
}
</style>
