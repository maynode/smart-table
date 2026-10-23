<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import {
  FIELD_TYPE_LABELS,
  dependentsByTrigger,
  emptyDisplayCondition,
  emptyDisplayRule,
  formatDisplayRuleConjunctionLabel,
  formatInboundDependentsLabel,
  formatOutboundConditionLabel,
  isFormFillableFieldType,
  normalizeDisplayRule,
  relatedDisplayFieldIds,
  walkDisplayConditionLeaves,
  type DisplayConditionOperator,
  type FieldType,
} from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { copyText } from '../ui/clipboard';
import { confirmDialog } from '../ui/dialog';
import { fieldTypeIcon } from '../ui/field-icons';
import { newId } from '../ui/id';
import { fillShareUrl, rewritePublicUrl } from '../ui/public-url';
import { toast } from '../ui/toast';
import type {
  DisplayConditionRuleDto,
  FieldDto,
  FormDto,
  FormFieldConfigDto,
  MemberDto,
  SheetDto,
} from '../api/types';
import DisplayRuleEditor from './DisplayRuleEditor.vue';
import FieldTypePicker from './FieldTypePicker.vue';
import FormFieldControl from './FormFieldControl.vue';

const props = withDefaults(
  defineProps<{
    baseId: string;
    sheet: SheetDto | null;
    workspaceId?: string;
    /** 作为主内容嵌入（侧栏点「收集表单」），非弹层 */
    embedded?: boolean;
    /** 进入时默认 Tab：编辑 / 填写 */
    initialTab?: 'design' | 'preview';
  }>(),
  { embedded: false, initialTab: undefined, workspaceId: undefined },
);
const emit = defineEmits<{
  close: [];
  /** 字段增删改后通知壳层刷新 sheet.fields */
  'sheet-updated': [sheet: SheetDto];
}>();

const form = ref<FormDto | null>(null);
const draftId = ref(newId());
const loading = ref(true);
const saving = ref(false);
const uploadingCover = ref(false);
const error = ref('');
const name = ref('');
const coverUrl = ref('');
const template = ref('');
const rejectDuplicatePhone = ref(true);
const shareEnabled = ref(true);
const audience = ref<'anyone' | 'workspace'>('anyone');
const expiresAt = ref('');
const items = ref<FormFieldConfigDto[]>([]);
const selectedFieldId = ref('');
const conditionOwnerId = ref('');
const addFieldId = ref('');
/** 企微进入收集表单默认「编辑表单」；可从结果页返回时指定 */
const previewTab = ref<'design' | 'preview'>(
  props.initialTab ?? 'design',
);
watch(
  () => props.initialTab,
  (tab) => {
    if (tab) previewTab.value = tab;
  },
);
watch(previewTab, (tab) => {
  if (tab !== 'preview') return;
  for (const item of items.value) {
    const field = fieldById.value.get(item.fieldId);
    if (!field) continue;
    if (previewValues.value[item.fieldId] === undefined) {
      previewValues.value[item.fieldId] = initPreviewValue(field);
    }
  }
  void loadPreviewExtras();
});
const successPreviewHtml = ref('');
const previewValues = ref<Record<string, unknown>>({});
const coverInput = ref<HTMLInputElement | null>(null);
const showConditionsFor = ref<Record<string, boolean>>({});
const description = ref('');
const shareDialogOpen = ref(false);
const conditionDialogOpen = ref(false);
const fieldPickerOpen = ref(false);
const fieldPickerMode = ref<'create' | 'edit'>('create');
const editingField = ref<FieldDto | null>(null);
const renamingFieldId = ref('');
const renameDraft = ref('');
/** 本地字段副本，支持表单内增删改名 */
const localFields = ref<FieldDto[]>([...(props.sheet?.fields ?? [])]);

watch(
  () => props.sheet?.id,
  () => {
    localFields.value = [...(props.sheet?.fields ?? [])];
  },
);
watch(
  () => props.sheet?.fields,
  (fields) => {
    if (fields) localFields.value = [...fields];
  },
);

function openConditionDialog(fieldId: string): void {
  selectedFieldId.value = fieldId;
  conditionDialogOpen.value = true;
}

const sheetFields = computed(() => localFields.value);
const fieldById = computed(
  () => new Map(sheetFields.value.map((field) => [field.id, field])),
);
/** 同手机号去重是领取场景能力，仅表单含手机号字段时露出 */
const formHasPhoneField = computed(() =>
  items.value.some((item) => fieldById.value.get(item.fieldId)?.type === 'phone'),
);

function emitSheetUpdated(): void {
  if (!props.sheet) return;
  emit('sheet-updated', { ...props.sheet, fields: [...localFields.value] });
}
const configuredIds = computed(() => new Set(items.value.map((item) => item.fieldId)));
const availableFields = computed(() =>
  sheetFields.value.filter(
    (field) =>
      !configuredIds.value.has(field.id) && isFormFillableFieldType(field.type),
  ),
);
const previewMembers = ref<Array<{ userId: string; name: string }>>([]);
const previewRelationChoices = ref<
  Record<string, Array<{ id: string; label: string }>>
>({});

async function loadPreviewExtras(): Promise<void> {
  let workspaceId = props.workspaceId;
  if (!workspaceId) {
    try {
      const base = await endpoints.getBase(props.baseId);
      workspaceId = base.workspaceId;
    } catch {
      workspaceId = undefined;
    }
  }
  if (workspaceId) {
    try {
      const members = await endpoints.listMembers(workspaceId);
      previewMembers.value = members.map((item: MemberDto) => ({
        userId: item.userId,
        name: item.name,
      }));
    } catch {
      previewMembers.value = [];
    }
  }
  const next: Record<string, Array<{ id: string; label: string }>> = {};
  for (const item of items.value) {
    const field = fieldById.value.get(item.fieldId);
    if (!field || field.type !== 'relation') continue;
    const targetSheetId = (
      field.options as { relation?: { targetSheetId?: string } } | null
    )?.relation?.targetSheetId;
    if (!targetSheetId) {
      next[item.fieldId] = [];
      continue;
    }
    try {
      const sheet = await endpoints.getSheet(targetSheetId);
      const page = await endpoints.listRecords(targetSheetId, null, 100);
      const titleField =
        sheet.fields?.find((f) => f.type === 'text' || f.type === 'title') ??
        sheet.fields?.[0] ??
        null;
      next[item.fieldId] = page.records.map((record) => {
        const raw = titleField ? record.cells[titleField.id] : null;
        const label =
          raw === null || raw === undefined || raw === ''
            ? record.id.slice(0, 8)
            : String(raw);
        return { id: record.id, label };
      });
    } catch {
      next[item.fieldId] = [];
    }
  }
  previewRelationChoices.value = next;
}

async function previewUpload(file: File) {
  if (!props.sheet) throw new Error('未选择工作表');
  return endpoints.uploadAttachment(props.sheet.id, file);
}

function initPreviewValue(field: FieldDto): unknown {
  if (field.type === 'multiSelect') return [];
  if (field.type === 'checkbox') return false;
  if (field.type === 'progress') return 0;
  return '';
}
const selectedConfig = computed(
  () => items.value.find((item) => item.fieldId === selectedFieldId.value) ?? null,
);
/** WeCom `form_visible_setting_unsupport`: 公式/查找不可作显示条件。 */
const conditionFieldCandidates = computed(() =>
  items.value.filter((item) => {
    if (item.fieldId === selectedConfig.value?.fieldId) return false;
    const field = fieldById.value.get(item.fieldId);
    if (!field) return false;
    return field.type !== 'formula' && field.type !== 'lookup';
  }),
);
const selectedSheetField = computed(
  () => fieldById.value.get(selectedFieldId.value) ?? null,
);
const formId = computed(() => form.value?.id ?? draftId.value);
/** 跟地址栏同源，避免 API 写死 localhost 导致手机/局域网打不开 */
const shareUrl = computed(() => {
  const token = form.value?.share.token;
  if (token) return fillShareUrl(token);
  return rewritePublicUrl(form.value?.share.qrUrl);
});
const qrDataUrl = ref('');
watch(
  shareUrl,
  async (url) => {
    if (!url) {
      qrDataUrl.value = form.value?.share.qrCodeDataUrl ?? '';
      return;
    }
    try {
      qrDataUrl.value = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    } catch {
      qrDataUrl.value = form.value?.share.qrCodeDataUrl ?? '';
    }
  },
  { immediate: true },
);
const expiresAtInput = computed({
  get: () => (expiresAt.value ? expiresAt.value.slice(0, 10) : ''),
  set: (value: string) => {
    expiresAt.value = value ? new Date(`${value}T23:59:59`).toISOString() : '';
  },
});
const previewFields = computed(() =>
  items.value
    .map((config) => ({
      config,
      field: fieldById.value.get(config.fieldId),
    }))
    .filter(
      (
        item,
      ): item is {
        config: FormFieldConfigDto;
        field: NonNullable<ReturnType<typeof fieldById.value.get>>;
      } => Boolean(item.field),
    ),
);
const activeConditionCount = computed(
  () =>
    items.value.reduce(
      (total, item) => total + walkDisplayConditionLeaves(item).length,
      0,
    ),
);

const conditionOperators: Array<{
  value: DisplayConditionOperator;
  label: string;
}> = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notEmpty', label: '不为空' },
  { value: 'isEmpty', label: '为空' },
];

const operatorLabelMap = Object.fromEntries(
  conditionOperators.map((op) => [op.value, op.label]),
) as Record<DisplayConditionOperator, string>;

const dependentsIndex = computed(() => dependentsByTrigger(items.value));

const relatedFieldIds = computed(() =>
  relatedDisplayFieldIds(selectedFieldId.value, items.value),
);

const dependencyTagsByField = computed(() => {
  const map = new Map<
    string,
    Array<{ kind: 'out' | 'in'; text: string; title: string }>
  >();
  for (const config of items.value) {
    const tags: Array<{ kind: 'out' | 'in'; text: string; title: string }> = [];
    const mode = formatDisplayRuleConjunctionLabel(config);
    if (mode) {
      tags.push({ kind: 'out', text: mode, title: mode });
    }
    for (const condition of walkDisplayConditionLeaves(config)) {
      if (
        !condition.fieldId &&
        condition.operator === 'equals' &&
        !condition.value
      ) {
        continue;
      }
      const text = formatOutboundConditionLabel(
        condition,
        fieldName,
        operatorLabelMap,
      );
      tags.push({ kind: 'out', text, title: text });
    }
    const dependentIds = dependentsIndex.value.get(config.fieldId) ?? [];
    const inbound = formatInboundDependentsLabel(dependentIds.map(fieldName));
    if (inbound) {
      tags.push({ kind: 'in', text: inbound, title: inbound });
    }
    if (tags.length) map.set(config.fieldId, tags);
  }
  return map;
});

const conditionCandidates = computed(() =>
  conditionFieldCandidates.value.map((item) => ({
    fieldId: item.fieldId,
    label: fieldName(item.fieldId),
  })),
);

function ensureDisplayRule(config: FormFieldConfigDto): DisplayConditionRuleDto {
  const normalized = normalizeDisplayRule(config);
  if (normalized) {
    config.displayRule = normalized as DisplayConditionRuleDto;
    return config.displayRule;
  }
  config.displayRule = emptyDisplayRule('and') as DisplayConditionRuleDto;
  return config.displayRule;
}

function pruneDisplayRule(
  rule: DisplayConditionRuleDto,
): DisplayConditionRuleDto {
  const conditions = rule.conditions
    .map((node) => {
      if ('conditions' in node) {
        const nested = pruneDisplayRule(node as DisplayConditionRuleDto);
        return nested.conditions.length > 0 ? nested : null;
      }
      const leaf = node as { fieldId?: string };
      return leaf.fieldId ? node : null;
    })
    .filter((node): node is NonNullable<typeof node> => node !== null);
  return { conjunction: rule.conjunction, conditions };
}

function setDisplayRule(
  config: FormFieldConfigDto,
  rule: DisplayConditionRuleDto,
): void {
  config.displayRule = rule;
  const leavesOnly =
    rule.conjunction === 'and' &&
    rule.conditions.every((node) => !('conditions' in node));
  config.displayConditions = leavesOnly
    ? (rule.conditions as FormFieldConfigDto['displayConditions'])
    : [];
}

function errorOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : '保存失败，请稍后再试';
}

function fieldName(fieldId: string): string {
  return fieldById.value.get(fieldId)?.name ?? fieldId;
}

function dependencyTags(fieldId: string): Array<{
  kind: 'out' | 'in';
  text: string;
  title: string;
}> {
  return dependencyTagsByField.value.get(fieldId) ?? [];
}

function relationHint(fieldId: string): string {
  if (!selectedFieldId.value || selectedFieldId.value === fieldId) return '';
  if (!relatedFieldIds.value.has(fieldId)) return '';
  const selected = items.value.find(
    (item) => item.fieldId === selectedFieldId.value,
  );
  const selectedDependsOn = selected
    ? walkDisplayConditionLeaves(selected).some((c) => c.fieldId === fieldId)
    : false;
  if (selectedDependsOn) return '被本字段依赖';
  return '依赖本字段';
}

function fieldRowClass(fieldId: string): Record<string, boolean> {
  return {
    selected: selectedFieldId.value === fieldId,
    'dep-related': relatedFieldIds.value.has(fieldId),
  };
}

async function load(): Promise<void> {
  if (!props.sheet) return;
  loading.value = true;
  error.value = '';
  try {
    const forms = await endpoints.listForms(props.baseId);
    form.value = forms.find((item) => item.sheetId === props.sheet?.id) ?? null;
    name.value = form.value?.name ?? `${props.sheet.name}收集表`;
    coverUrl.value = form.value?.coverUrl ?? '';
    template.value =
      form.value?.successPage.templateHtml ??
      '<div class="success-shell"><div class="success-check">✓</div><h2>已提交</h2><p>你的序列号是 <strong>{{序列号}}</strong></p></div>';
    rejectDuplicatePhone.value = form.value?.rejectDuplicatePhone ?? true;
    shareEnabled.value = form.value?.share.enabled ?? true;
    audience.value = form.value?.share.audience ?? 'anyone';
    expiresAt.value = form.value?.share.expiresAt ?? '';

    const sheetIds = new Set(sheetFields.value.map((field) => field.id));
    const existing = (form.value?.fields ?? [])
      .filter((item) => {
        if (!sheetIds.has(item.fieldId)) return false;
        const field = fieldById.value.get(item.fieldId);
        return field ? isFormFillableFieldType(field.type) : false;
      })
      .map((item) => {
        const next: FormFieldConfigDto = {
          ...item,
          displayConditions: (item.displayConditions ?? []).map((condition) => ({
            ...condition,
          })),
          displayRule: item.displayRule
            ? (JSON.parse(JSON.stringify(item.displayRule)) as DisplayConditionRuleDto)
            : undefined,
        };
        ensureDisplayRule(next);
        return next;
      });
    // Form 字段全是孤儿 ID / 尚未配置时，回退到可填工作表列
    items.value =
      existing.length > 0
        ? existing
        : sheetFields.value
            .filter((field) => isFormFillableFieldType(field.type))
            .map((field) => {
              const next: FormFieldConfigDto = {
                fieldId: field.id,
                required: field.required,
                displayRule: emptyDisplayRule('and') as DisplayConditionRuleDto,
              };
              return next;
            });
    if (!selectedFieldId.value || !items.value.some((i) => i.fieldId === selectedFieldId.value)) {
      selectedFieldId.value = items.value[0]?.fieldId ?? '';
    }
    void loadPreviewExtras();
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    loading.value = false;
  }
}

function savePayload() {
  if (!props.sheet) throw new Error('请先选择工作表');
  return {
    baseId: props.baseId,
    sheetId: props.sheet.id,
    name: name.value.trim() || `${props.sheet.name}收集表`,
    coverUrl: coverUrl.value || undefined,
    fields: items.value.map((item) => {
      const rule = pruneDisplayRule(ensureDisplayRule(item));
      setDisplayRule(item, rule);
      return {
        fieldId: item.fieldId,
        required: Boolean(item.required),
        displayRule: rule.conditions.length > 0 ? rule : undefined,
        displayConditions: item.displayConditions ?? [],
      };
    }),
    share: {
      enabled: shareEnabled.value,
      audience: audience.value,
      expiresAt: expiresAt.value || null,
    },
    successPage: { templateHtml: template.value },
    rejectDuplicatePhone: rejectDuplicatePhone.value,
  };
}

async function save(showToast = true): Promise<FormDto | null> {
  if (!props.sheet || saving.value) return form.value;
  saving.value = true;
  error.value = '';
  try {
    form.value = await endpoints.upsertForm(formId.value, savePayload());
    if (showToast) toast('表单已保存');
    return form.value;
  } catch (caught) {
    error.value = errorOf(caught);
    return null;
  } finally {
    saving.value = false;
  }
}

function move(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= items.value.length) return;
  const list = [...items.value];
  [list[index], list[target]] = [list[target], list[index]];
  items.value = list;
}

function removeItem(index: number): void {
  const removed = items.value[index];
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index);
  if (removed?.fieldId === selectedFieldId.value) {
    selectedFieldId.value = items.value[0]?.fieldId ?? '';
  }
  void save(false);
}

function removeAllFields(): void {
  items.value = [];
  selectedFieldId.value = '';
  void save(false);
}

function addAvailableField(fieldId: string): void {
  addFieldId.value = fieldId;
  addField();
}

async function openShareDialog(): Promise<void> {
  if (!form.value) await save(false);
  shareDialogOpen.value = true;
}

function addField(): void {
  const field = availableFields.value.find(
    (candidate) => candidate.id === addFieldId.value,
  ) ?? availableFields.value[0];
  if (!field) return;
  items.value = [
    ...items.value,
    { fieldId: field.id, required: field.required, displayConditions: [] },
  ];
  selectedFieldId.value = field.id;
  addFieldId.value = '';
  void save(false);
}

function openCreateFieldPicker(): void {
  fieldPickerMode.value = 'create';
  editingField.value = null;
  fieldPickerOpen.value = true;
}

function openEditFieldType(field: FieldDto): void {
  selectedFieldId.value = field.id;
  fieldPickerMode.value = 'edit';
  editingField.value = field;
  fieldPickerOpen.value = true;
}

function closeFieldPicker(): void {
  fieldPickerOpen.value = false;
  editingField.value = null;
  fieldPickerMode.value = 'create';
}

async function onFieldPickerConfirm(payload: {
  name: string;
  type: FieldType;
  options?: Record<string, unknown>;
}): Promise<void> {
  if (fieldPickerMode.value === 'edit' && editingField.value) {
    await onUpdateFieldType(editingField.value, payload);
    return;
  }
  await onCreateField(payload);
}

async function onCreateField(payload: {
  name: string;
  type: FieldType;
  options?: Record<string, unknown>;
}): Promise<void> {
  if (!props.sheet) return;
  closeFieldPicker();
  try {
    const created = await endpoints.createField(props.sheet.id, {
      name: payload.name.trim() || '新字段',
      type: payload.type,
      options: payload.options,
      order: localFields.value.length,
    });
    localFields.value = [...localFields.value, created];
    if (isFormFillableFieldType(created.type)) {
      items.value = [
        ...items.value,
        { fieldId: created.id, required: false, displayConditions: [] },
      ];
      selectedFieldId.value = created.id;
      emitSheetUpdated();
      void loadPreviewExtras();
      await save(false);
      toast('已添加字段');
    } else {
      emitSheetUpdated();
      toast(
        `「${created.name}」已加到表格，但${FIELD_TYPE_LABELS[created.type as FieldType] ?? created.type}不能加入收集表单`,
      );
    }
  } catch (caught) {
    toast(errorOf(caught));
  }
}

async function onUpdateFieldType(
  field: FieldDto,
  payload: {
    name: string;
    type: FieldType;
    options?: Record<string, unknown>;
  },
): Promise<void> {
  closeFieldPicker();
  const nextName = payload.name.trim() || field.name;
  const typeChanged = payload.type !== field.type;
  if (
    !typeChanged &&
    nextName === field.name &&
    JSON.stringify(payload.options ?? {}) === JSON.stringify(field.options ?? {})
  ) {
    return;
  }
  if (typeChanged) {
    const ok = await confirmDialog(
      `将「${field.name}」的类型改为「${FIELD_TYPE_LABELS[payload.type]}」？已有单元格值可能无法按新类型展示。`,
    );
    if (!ok) return;
  }
  try {
    const updated = await endpoints.updateField(field.id, {
      name: nextName,
      type: payload.type,
      options: payload.options,
    });
    localFields.value = localFields.value.map((item) =>
      item.id === field.id
        ? {
            ...item,
            ...updated,
            name: nextName,
            type: payload.type,
            options: (payload.options as FieldDto['options']) ?? item.options,
          }
        : item,
    );
    emitSheetUpdated();
    toast(typeChanged ? '字段类型已更新' : '字段已更新');
  } catch (caught) {
    toast(errorOf(caught));
  }
}

function typeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type as FieldType] ?? type;
}

function beginRename(field: FieldDto): void {
  renamingFieldId.value = field.id;
  renameDraft.value = field.name;
}

async function commitRename(): Promise<void> {
  const fieldId = renamingFieldId.value;
  const next = renameDraft.value.trim();
  renamingFieldId.value = '';
  if (!fieldId || !next) return;
  const current = fieldById.value.get(fieldId);
  if (!current || current.name === next) return;
  try {
    const updated = await endpoints.updateField(fieldId, { name: next });
    localFields.value = localFields.value.map((field) =>
      field.id === fieldId ? { ...field, ...updated, name: next } : field,
    );
    emitSheetUpdated();
    toast('字段已重命名');
  } catch (caught) {
    toast(errorOf(caught));
  }
}

async function deleteFieldFromForm(index: number): Promise<void> {
  const item = items.value[index];
  if (!item) return;
  const field = fieldById.value.get(item.fieldId);
  const label = field?.name ?? '该字段';
  const ok = await confirmDialog(
    `从表单移除并删除字段「${label}」？已有填写数据中的该列也会清空。`,
  );
  if (!ok) return;
  try {
    await endpoints.deleteField(item.fieldId);
    localFields.value = localFields.value.filter((f) => f.id !== item.fieldId);
    items.value = items.value.filter((_, i) => i !== index);
    if (selectedFieldId.value === item.fieldId) {
      selectedFieldId.value = items.value[0]?.fieldId ?? '';
    }
    emitSheetUpdated();
    await save(false);
    toast('字段已删除');
  } catch (caught) {
    toast(errorOf(caught));
  }
}

function addCondition(config: FormFieldConfigDto): void {
  const rule = ensureDisplayRule(config);
  setDisplayRule(config, {
    ...rule,
    conditions: [...rule.conditions, emptyDisplayCondition()],
  });
  showConditionsFor.value[config.fieldId] = true;
}

async function uploadCover(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  uploadingCover.value = true;
  try {
    if (!form.value) {
      const saved = await save(false);
      if (!saved) return;
    }
    const result = await endpoints.uploadFormCover(formId.value, file);
    coverUrl.value = result.coverUrl;
    await save(false);
    toast('封面已更新');
  } catch (caught) {
    error.value = errorOf(caught);
  } finally {
    uploadingCover.value = false;
  }
}

async function copyShareUrl(): Promise<void> {
  if (!shareUrl.value) {
    toast('请先保存表单，生成分享链接');
    return;
  }
  const ok = await copyText(shareUrl.value);
  toast(ok ? '分享链接已复制' : '复制失败，请手动选中链接复制');
}

const successVariables = computed(() => {
  const names = items.value
    .map((item) => fieldName(item.fieldId))
    .filter((name) => Boolean(name.trim()));
  const extras = ['序列号'];
  return [...new Set([...extras, ...names])];
});

function insertVariable(variable: string): void {
  template.value = `${template.value}{{${variable}}}`;
}

async function previewSuccess(): Promise<void> {
  if (!form.value) {
    const saved = await save(false);
    if (!saved) return;
  }
  try {
    const sampleCells = Object.fromEntries(
      items.value.map((item) => [
        fieldName(item.fieldId),
        previewValues.value[item.fieldId] ??
          ({
            phone: '13800000000',
            email: 'demo@example.com',
            number: 1,
            date: '2026-10-22',
            checkbox: true,
          }[fieldById.value.get(item.fieldId)?.type ?? ''] ?? `示例${fieldName(item.fieldId)}`),
      ]),
    );
    const response = await endpoints.previewFormSuccess(formId.value, {
      formCells: sampleCells,
      stepOutputs: { 序列号: 'SN-000123' },
    });
    successPreviewHtml.value = response.html;
    previewTab.value = 'preview';
  } catch (caught) {
    error.value = errorOf(caught);
  }
}

onMounted(load);
</script>

<template>
  <div
    class="form-builder"
    :class="{ embedded }"
    data-testid="form-builder"
  >
    <input
      ref="coverInput"
      type="file"
      accept="image/*"
      class="hidden-cover-input"
      data-testid="form-cover-input"
      @change="uploadCover"
    />
    <header class="panel-header" :class="{ embedded }">
      <div class="header-left">
        <button
          v-if="embedded"
          class="ghost-tool"
          type="button"
          title="撤销（暂未接入）"
          disabled
        >
          ↶
        </button>
        <button
          v-if="embedded"
          class="ghost-tool"
          type="button"
          title="重做（暂未接入）"
          disabled
        >
          ↷
        </button>
        <button
          v-if="embedded"
          class="ghost-link"
          type="button"
          data-testid="form-automation-hint"
          @click="toast('请用顶栏「自动化」配置提交后联动')"
        >
          设置自动化提醒
        </button>
        <h3 v-if="!embedded">收集表单</h3>
      </div>
      <div class="tabs">
        <button
          :class="{ active: previewTab === 'design' }"
          data-testid="form-tab-edit"
          @click="previewTab = 'design'"
        >
          编辑表单
        </button>
        <button
          :class="{ active: previewTab === 'preview' }"
          data-testid="form-tab-fill"
          @click="previewTab = 'preview'"
        >
          填写表单
        </button>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-primary small"
          type="button"
          data-testid="form-share-open"
          @click="openShareDialog"
        >
          分享表单
        </button>
        <button
          v-if="!embedded"
          class="icon-btn"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <p v-if="error" class="form-error" data-testid="form-builder-error">{{ error }}</p>

      <div v-if="previewTab === 'design'" class="builder-layout">
        <aside class="available-pane">
          <section class="builder-section">
            <div class="field-heading">
              <span class="section-title">可添加字段</span>
              <span v-if="availableFields.length" class="section-count">{{ availableFields.length }}</span>
            </div>
            <div v-if="availableFields.length === 0" class="available-empty">
              <p class="empty-state-title">没有可添加的字段</p>
              <p class="empty-state-hint">工作表字段都已加入表单，也可新建字段。</p>
            </div>
            <div v-else class="available-list">
              <button
                v-for="field in availableFields"
                :key="field.id"
                type="button"
                class="available-row"
                :title="`添加「${field.name}」`"
                @click="addAvailableField(field.id)"
              >
                <span class="field-icon">{{ fieldTypeIcon(field.type) }}</span>
                <span class="available-name">{{ field.name }}</span>
                <span class="available-add">添加</span>
              </button>
            </div>
            <button
              class="add-field-to-form"
              type="button"
              data-testid="form-add-field"
              @click="openCreateFieldPicker"
            >
              <span class="add-field-plus">+</span>
              添加新字段到表单
            </button>
          </section>

          <section class="builder-section">
            <div class="field-heading">
              <span class="section-title">表单字段</span>
              <button
                v-if="items.length"
                class="nl-link"
                type="button"
                @click="removeAllFields"
              >
                全部移出
              </button>
            </div>
            <div v-if="items.length === 0" class="available-empty">
              <p class="empty-state-title">表单还是空的</p>
              <p class="empty-state-hint">从上方点选字段加入，或新建字段。</p>
            </div>
            <div v-else class="builder-fields" data-testid="form-fields">
              <div
                v-for="(item, index) in items"
                :key="item.fieldId"
                class="field-row"
                :class="fieldRowClass(item.fieldId)"
                :data-testid="`form-field-${item.fieldId}`"
                @click="selectedFieldId = item.fieldId"
              >
                <div class="field-row-main">
                  <span class="field-icon">{{ fieldTypeIcon(fieldById.get(item.fieldId)?.type ?? 'text') }}</span>
                  <div class="field-meta">
                    <span class="field-name" :title="fieldName(item.fieldId)">{{ fieldName(item.fieldId) }}</span>
                    <span
                      v-if="relationHint(item.fieldId)"
                      class="dep-relation-hint"
                    >{{ relationHint(item.fieldId) }}</span>
                  </div>
                </div>
                <div class="field-row-actions" @click.stop>
                  <label class="inline-check">
                    <input
                      v-model="item.required"
                      type="checkbox"
                      :data-testid="`form-required-${item.fieldId}`"
                    />
                    必填
                  </label>
                  <div class="field-row-tools">
                    <button
                      class="icon-btn"
                      type="button"
                      title="上移"
                      aria-label="上移"
                      :disabled="index === 0"
                      @click="move(index, -1)"
                    >↑</button>
                    <button
                      class="icon-btn"
                      type="button"
                      title="下移"
                      aria-label="下移"
                      :disabled="index === items.length - 1"
                      @click="move(index, 1)"
                    >↓</button>
                    <button
                      class="icon-btn danger"
                      type="button"
                      title="从表单移除"
                      aria-label="从表单移除"
                      :data-testid="`form-remove-${item.fieldId}`"
                      @click="removeItem(index)"
                    >×</button>
                  </div>
                </div>
                <div
                  v-if="dependencyTags(item.fieldId).length"
                  class="dep-tags"
                  :data-testid="`form-dep-tags-${item.fieldId}`"
                >
                  <span
                    v-for="(tag, tagIndex) in dependencyTags(item.fieldId)"
                    :key="`${tag.kind}-${tagIndex}`"
                    class="dep-tag"
                    :class="tag.kind === 'out' ? 'dep-tag-out' : 'dep-tag-in'"
                    :title="tag.title"
                  >{{ tag.text }}</span>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="selectedConfig"
            class="builder-section field-settings"
            data-testid="form-field-settings"
          >
            <header class="field-settings-head">
              <strong class="section-title">显示条件</strong>
              <p class="setting-hint">
                「{{ fieldName(selectedConfig.fieldId) }}」何时显示；可组合且/或并嵌套条件组
              </p>
            </header>
            <DisplayRuleEditor
              :model-value="ensureDisplayRule(selectedConfig)"
              :candidates="conditionCandidates"
              :operators="conditionOperators"
              @update:model-value="setDisplayRule(selectedConfig, $event)"
            />
          </section>

          <section class="builder-section fill-settings" data-testid="form-fill-settings">
            <div class="field-heading">
              <span class="section-title">填写设置</span>
            </div>
            <label class="builder-inline">
              <span class="builder-label">填写截止时间</span>
              <input v-model="expiresAtInput" type="date" data-testid="form-expires-at" />
            </label>
            <p class="setting-hint">到期后公开链接不可再提交；留空表示不限期。</p>
            <label class="builder-inline">
              <span class="builder-label">谁可以填写</span>
              <select v-model="audience" data-testid="form-audience">
                <option value="anyone">企业内、外所有成员</option>
                <option value="workspace">仅工作区成员</option>
              </select>
            </label>
            <label class="inline-check setting-check">
              <input v-model="shareEnabled" type="checkbox" data-testid="form-share-enabled" />
              启用表单链接
            </label>
            <template v-if="formHasPhoneField">
              <label class="inline-check setting-check">
                <input
                  v-model="rejectDuplicatePhone"
                  type="checkbox"
                  data-testid="form-reject-duplicate"
                />
                同手机号仅可提交一次
              </label>
              <p class="setting-hint">
                领取类场景用：已提交过的手机号会被拒绝。普通问卷可关掉。
              </p>
            </template>
          </section>

          <section class="builder-section success-settings">
            <div class="field-heading">
              <span class="section-title">成功页</span>
              <button
                class="nl-link"
                type="button"
                :disabled="saving"
                @click="previewSuccess"
              >
                预览
              </button>
            </div>
            <p class="setting-hint">提交后展示；点击下方标签可插入字段变量。</p>
            <div class="variable-actions">
              <button
                v-for="name in successVariables"
                :key="name"
                class="var-chip"
                type="button"
                @click="insertVariable(name)"
              >
                {{ name }}
              </button>
            </div>
            <label class="builder-field">
              <span class="sr-only">成功页 HTML 模板</span>
              <textarea
                v-model="template"
                data-testid="form-template-input"
                rows="5"
                placeholder="例如：&lt;h2&gt;已提交&lt;/h2&gt;&lt;p&gt;序列号 {{序列号}}&lt;/p&gt;"
              />
            </label>
          </section>

          <div class="builder-actions" :class="{ 'embedded-save': embedded }">
            <button
              class="btn btn-primary"
              data-testid="form-builder-save"
              :disabled="saving || uploadingCover || !sheet"
              @click="save()"
            >
              {{ saving ? '保存中…' : '保存表单' }}
            </button>
          </div>
        </aside>

        <div class="canvas-pane">
          <div class="form-canvas">
            <button
              class="cover-btn"
              type="button"
              :disabled="uploadingCover"
              @click="coverInput?.click()"
            >
              <img v-if="coverUrl" :src="coverUrl" alt="封面" class="cover-preview" />
              <span v-else class="cover-placeholder">
                <span class="cover-placeholder-title">{{ uploadingCover ? '上传中…' : '添加封面' }}</span>
                <span v-if="!uploadingCover" class="cover-placeholder-hint">建议宽图，展示在填写页顶部</span>
              </span>
            </button>
            <input
              v-model="name"
              class="canvas-title"
              data-testid="form-name-input"
              maxlength="100"
              placeholder="表单"
            />
            <input
              v-model="description"
              class="canvas-desc"
              placeholder="添加描述"
            />
            <div
              v-for="(item, index) in previewFields"
              :key="item.config.fieldId"
              class="canvas-field"
              :class="fieldRowClass(item.config.fieldId)"
              @click="selectedFieldId = item.config.fieldId"
            >
              <div class="canvas-field-label">
                <em v-if="item.config.required" class="required-star">*</em>
                <input
                  v-if="renamingFieldId === item.field.id"
                  v-model="renameDraft"
                  class="rename-input"
                  maxlength="40"
                  data-testid="form-field-rename"
                  @click.stop
                  @keydown.enter.prevent="commitRename"
                  @blur="commitRename"
                />
                <button
                  v-else
                  type="button"
                  class="rename-trigger"
                  title="点击修改字段名"
                  @click.stop="beginRename(item.field)"
                >
                  {{ item.field.name }}
                </button>
                <span
                  v-if="relationHint(item.config.fieldId)"
                  class="dep-relation-hint"
                >{{ relationHint(item.config.fieldId) }}</span>
              </div>
              <div
                v-if="dependencyTags(item.config.fieldId).length"
                class="dep-tags"
                :data-testid="`form-canvas-dep-tags-${item.config.fieldId}`"
              >
                <span
                  v-for="(tag, tagIndex) in dependencyTags(item.config.fieldId)"
                  :key="`${tag.kind}-${tagIndex}`"
                  class="dep-tag"
                  :class="tag.kind === 'out' ? 'dep-tag-out' : 'dep-tag-in'"
                  :title="tag.title"
                >{{ tag.text }}</span>
              </div>
              <div class="canvas-field-input" aria-hidden="true">填写人将在此作答</div>
              <div
                v-if="selectedFieldId === item.config.fieldId"
                class="canvas-toolbar"
              >
                <span class="toolbar-type">
                  字段
                  <button
                    type="button"
                    class="type-pill"
                    data-testid="form-field-type"
                    title="修改字段类型"
                    @click.stop="openEditFieldType(item.field)"
                  >
                    {{ fieldTypeIcon(item.field.type) }}
                    {{ typeLabel(item.field.type) }}
                    <span class="type-pill-caret">▾</span>
                  </button>
                </span>
                <label class="inline-check">
                  <input
                    v-model="item.config.required"
                    type="checkbox"
                    @change="save(false)"
                  />
                  必填
                </label>
                <button
                  class="toolbar-link"
                  type="button"
                  @click.stop="
                    selectedFieldId = item.config.fieldId;
                    if (selectedConfig) addCondition(selectedConfig);
                  "
                >
                  显示条件
                </button>
                <button
                  class="icon-btn danger"
                  type="button"
                  title="删除字段"
                  data-testid="form-field-delete"
                  @click.stop="deleteFieldFromForm(index)"
                >
                  －
                </button>
              </div>
            </div>
            <button
              class="canvas-add"
              type="button"
              data-testid="form-add-new-field"
              @click="openCreateFieldPicker"
            >
              + 添加新字段
            </button>
          </div>
        </div>
      </div>

      <div v-else class="fill-preview-pane">
        <div class="form-canvas fill-mode">
          <img v-if="coverUrl" :src="coverUrl" class="fill-cover" alt="封面" />
          <h2>{{ name || '未命名表单' }}</h2>
          <p v-if="description" class="canvas-desc-static">{{ description }}</p>
          <div v-for="item in previewFields" :key="item.config.fieldId" class="preview-field">
            <span>
              <em v-if="item.config.required" class="required-star">*</em>
              {{ item.field.name }}
            </span>
            <FormFieldControl
              v-model="previewValues[item.config.fieldId]"
              :field-id="item.config.fieldId"
              :name="item.field.name"
              :type="item.field.type"
              :options="item.field.options"
              :required="item.config.required"
              :members="previewMembers"
              :relation-choices="previewRelationChoices[item.config.fieldId] ?? []"
              :upload-file="previewUpload"
            />
          </div>
          <button class="preview-submit" type="button" disabled>提交</button>
        </div>
        <section class="success-preview">
          <header class="success-preview-head">
            <h4>成功页预览</h4>
            <button class="btn small" type="button" @click="previewSuccess">刷新预览</button>
          </header>
          <div
            class="success-html"
            data-testid="form-success-preview"
            v-html="
              successPreviewHtml ||
              '<p class=&quot;muted&quot;>点左侧「预览」或上方「刷新预览」，用示例数据看插值结果。</p>'
            "
          ></div>
        </section>
      </div>

      <!-- 非嵌入：底部分享条；嵌入模式用顶栏「分享表单」对话框 -->
      <section v-if="form && !embedded" class="share-box">
        <div class="share-box-main">
          <strong class="share-box-title">分享链接</strong>
          <p class="share-url" data-testid="form-share-url">{{ shareUrl || '保存表单后生成链接' }}</p>
          <div class="share-actions">
            <button class="btn small" type="button" @click="copyShareUrl">复制链接</button>
            <a
              v-if="shareUrl"
              class="btn small"
              :href="shareUrl"
              target="_blank"
              rel="noreferrer"
            >打开填写页</a>
          </div>
          <p class="share-status" data-testid="form-share-status">
            {{ form.share.enabled ? '链接已启用' : '链接已关闭' }} ·
            {{ form.share.audience === 'workspace' ? '仅工作区成员' : '企业内、外所有成员' }}
            <template v-if="form.share.expiresAt">
              · 截止 {{ new Date(form.share.expiresAt).toLocaleDateString('zh-CN') }}
            </template>
          </p>
        </div>
        <div class="share-box-qr">
          <img
            v-if="form.share.qrCodeDataUrl"
            :src="form.share.qrCodeDataUrl"
            class="share-qr"
            data-testid="form-share-qr"
            alt="表单二维码"
          />
          <p v-else class="share-qr-empty">保存并启用链接后显示二维码</p>
        </div>
      </section>

      <div
        v-if="shareDialogOpen"
        class="share-mask"
        data-testid="form-share-dialog"
        @click.self="shareDialogOpen = false"
      >
        <div class="share-dialog">
          <header>
            <h4>分享表单</h4>
            <button
              class="icon-btn"
              type="button"
              aria-label="关闭"
              @click="shareDialogOpen = false"
            >×</button>
          </header>
          <p class="setting-hint">
            成员可通过链接直接添加记录。截止时间、填写范围等请在左侧「填写设置」修改。
          </p>
          <p
            v-if="!shareEnabled"
            class="form-error"
            data-testid="form-share-disabled-hint"
          >
            表单链接未启用，请先在左侧打开「启用表单链接」并保存。
          </p>
          <label class="builder-field">
            <span class="builder-label">填写链接</span>
            <p
              class="share-url share-url-box"
              data-testid="form-share-url-dialog"
            >{{ shareUrl || '保存表单后生成' }}</p>
          </label>
          <div class="share-invite">
            <button
              class="btn btn-primary"
              type="button"
              :disabled="!shareEnabled || !shareUrl"
              @click="copyShareUrl"
            >
              复制链接
            </button>
            <a
              v-if="shareUrl && shareEnabled"
              class="btn"
              :href="shareUrl"
              target="_blank"
              rel="noreferrer"
            >打开填写页</a>
          </div>
          <div v-if="qrDataUrl && shareEnabled" class="share-dialog-qr">
            <img
              :src="qrDataUrl"
              class="share-qr"
              data-testid="form-share-qr-dialog"
              alt="二维码"
            />
            <p class="setting-hint">扫码打开填写页</p>
          </div>
          <footer>
            <button class="btn" type="button" @click="shareDialogOpen = false">
              完成
            </button>
          </footer>
        </div>
      </div>

      <FieldTypePicker
        :open="fieldPickerOpen"
        :mode="fieldPickerMode"
        fillable-only
        :initial-name="editingField?.name ?? ''"
        :initial-type="(editingField?.type as FieldType) ?? 'text'"
        :initial-options="editingField?.options ?? null"
        @close="closeFieldPicker"
        @confirm="onFieldPickerConfirm"
      />
    </template>
  </div>
</template>

<style scoped>
.form-builder {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-builder.embedded {
  flex: 1;
  height: 100%;
  min-height: 0;
  gap: 0;
  background: #f2f4f7;
}
.form-builder.embedded .panel-header {
  flex: none;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid var(--border, #e5e6eb);
}
.form-builder.embedded .builder-layout,
.form-builder.embedded .fill-preview-pane {
  flex: 1 1 auto;
  min-height: 320px;
  overflow: auto;
}
.form-builder.embedded .builder-layout {
  grid-template-columns: minmax(360px, 40%) minmax(0, 1fr);
  gap: 0;
  background: #fff;
}
.form-builder.embedded .available-pane {
  max-height: none;
  height: 100%;
  padding: 14px 16px;
  border-right: 1px solid var(--border, #e5e6eb);
  background: #f7f8fa;
}
.form-builder.embedded .canvas-pane {
  padding: 20px 16px;
  background: #f2f4f7;
  overflow: auto;
}
.panel-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.header-left h3 {
  margin: 0;
}
.ghost-tool {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8f959e;
  cursor: pointer;
}
.ghost-tool:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.ghost-link {
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #646a73;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.ghost-link:hover {
  background: #f2f3f5;
  color: #1d6fdc;
}
.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.tabs {
  display: flex;
  gap: 20px;
  justify-content: center;
  border-bottom: none;
}
.form-builder.embedded .tabs {
  border-bottom: none;
}
.tabs button {
  height: 36px;
  padding: 0 4px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary, #646a73);
  font-size: 14px;
  cursor: pointer;
}
.tabs button.active {
  background: transparent;
  color: var(--brand-strong, #1d6fdc);
  box-shadow: none;
  border-bottom-color: var(--brand, #2d8cf0);
  font-weight: 600;
}
.builder-layout {
  display: grid;
  grid-template-columns: minmax(360px, 400px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}
.available-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  max-height: 70vh;
  overflow: auto;
}
.builder-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
  letter-spacing: 0.01em;
}
.section-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: #eef0f3;
  color: #646a73;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
.available-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 20px 14px;
  border: 1px dashed #d0d5dd;
  border-radius: 10px;
  text-align: center;
  background: #fafbfc;
}
.available-empty .empty-state-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #4e5969;
}
.available-empty .empty-state-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #8a9099;
}
.available-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.add-field-to-form {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px dashed #b7d0f5;
  border-radius: 10px;
  background: #f7faff;
  color: #1d6fdc;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.add-field-to-form:hover {
  background: #eef5ff;
  border-color: #91caff;
}
.add-field-to-form:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.add-field-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #fff;
  color: #1d6fdc;
  font-weight: 600;
  border: 1px solid #d6e4ff;
}
.fill-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border, #e5e6eb);
}
.setting-hint {
  margin: 0;
  color: #8f959e;
  font-size: 12px;
  line-height: 1.45;
}
.field-settings-head .setting-hint {
  margin-top: 4px;
}
.builder-label {
  font-size: 12px;
  font-weight: 500;
  color: #4e5969;
}
.setting-check {
  min-height: 32px;
  padding: 4px 0;
}
.embedded-save {
  margin-top: auto;
  padding-top: 12px;
}
.available-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #eaecf0;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  font-size: 13px;
  color: #1f2329;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.available-row:hover {
  border-color: #91caff;
  background: #f5f8ff;
}
.available-row:hover .available-add {
  opacity: 1;
  color: #1d6fdc;
}
.available-row:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.available-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.available-add {
  flex-shrink: 0;
  font-size: 12px;
  color: #8f959e;
  opacity: 0.7;
  transition: opacity 0.15s ease, color 0.15s ease;
}
.nl-link {
  border: none;
  background: transparent;
  color: #1d6fdc;
  font-size: 12px;
  cursor: pointer;
}
.canvas-pane {
  min-width: 0;
  background: #f2f4f7;
  border-radius: 12px;
  padding: 20px;
  overflow: auto;
}
.form-canvas {
  max-width: 520px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.cover-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 96px;
  margin-bottom: 16px;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
  background: linear-gradient(180deg, #fafbfc 0%, #f2f4f7 100%);
  color: #667085;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.cover-btn:hover:not(:disabled) {
  border-color: #91caff;
  background: linear-gradient(180deg, #f7faff 0%, #eef5ff 100%);
}
.cover-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}
.cover-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
}
.cover-placeholder-title {
  font-size: 14px;
  font-weight: 500;
  color: #4e5969;
}
.cover-placeholder-hint {
  font-size: 12px;
  color: #8f959e;
}
.cover-btn .cover-preview {
  width: 100%;
  height: auto;
  max-height: 160px;
  object-fit: cover;
  display: block;
}
.canvas-title {
  width: 100%;
  border: none;
  border-radius: 6px;
  font-size: 22px;
  font-weight: 600;
  outline: none;
  margin-bottom: 4px;
  padding: 4px 6px;
  color: #1f2329;
}
.canvas-title:focus {
  background: #f7f8fa;
}
.canvas-desc,
.canvas-desc-static {
  width: 100%;
  border: none;
  border-radius: 6px;
  color: #8f959e;
  font-size: 13px;
  outline: none;
  margin-bottom: 20px;
  padding: 4px 6px;
  line-height: 1.5;
}
.canvas-desc:focus {
  background: #f7f8fa;
  color: #4e5969;
}
.canvas-field {
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.canvas-field:hover {
  background: #fafbfc;
}
.canvas-field.selected {
  border-color: #91caff;
  box-shadow: 0 0 0 1px #91caff;
  background: #f5f8ff;
}
.canvas-field.dep-related {
  border-color: #91caff;
  background: #f0f7ff;
}
.canvas-field-label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
}
.dep-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 6px;
  min-width: 0;
}
.field-row .dep-tags {
  margin: 4px 0 0 30px;
}
.dep-tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 8px;
  border-radius: 999px;
}
.dep-tag-out {
  background: #e6f4ff;
  color: #1677ff;
}
.dep-tag-in {
  background: #fff7e6;
  color: #d46b08;
}
.dep-relation-hint {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 400;
  color: #1677ff;
}
.rename-trigger {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-weight: 500;
  color: inherit;
  cursor: text;
  text-align: left;
}
.rename-trigger:hover {
  color: var(--brand-strong, #1d6fdc);
}
.rename-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--brand, #2d8cf0);
  border-radius: 6px;
  font: inherit;
  outline: none;
}
.canvas-hint,
.fill-edit-hint {
  margin: 10px 0 0;
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
  text-align: center;
}
.fill-edit-hint {
  margin: 0 0 12px;
}
.canvas-field-input {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f6f7;
  color: #98a2b3;
  font-size: 13px;
}
.canvas-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 8px;
  border-radius: 8px;
  background: #f5f6f8;
  font-size: 12px;
}
.toolbar-type {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.type-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #e5e6eb;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.type-pill:hover {
  border-color: #1d6fdc;
  color: #1d6fdc;
}
.type-pill-caret {
  font-size: 10px;
  opacity: 0.7;
}
.toolbar-link {
  border: none;
  background: transparent;
  color: #667085;
  cursor: pointer;
}
.canvas-add {
  width: 100%;
  height: 40px;
  margin-top: 12px;
  border: 1px dashed #b7d0f5;
  border-radius: 10px;
  background: #f7faff;
  color: var(--brand-strong, #1d6fdc);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.canvas-add:hover {
  background: #eef5ff;
  border-color: #91caff;
}
.canvas-add:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.fill-preview-pane {
  display: block;
  background: var(--bg-muted, #f7f8fa);
  padding: 24px 16px;
  border-radius: 10px;
}
.fill-preview-pane .form-canvas {
  max-width: 480px;
  margin: 0 auto;
}
.fill-mode {
  background: #fff;
}
.fill-cover {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 12px;
}
.share-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.35);
}
.share-dialog {
  width: min(420px, 92vw);
  padding: 16px;
  border-radius: 12px;
  background: #fff;
}
.share-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.share-dialog h4 {
  margin: 0;
}
.share-invite {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
}
.share-dialog footer {
  display: flex;
  justify-content: flex-end;
}
.btn.small {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.builder-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #344054;
}
.builder-field > input,
.builder-field textarea {
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 13px;
  font-family: inherit;
}
.field-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
.field-heading small {
  color: #98a2b3;
  font-size: 11px;
}
.builder-fields {
  border: 1px solid #eaecf0;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.field-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f2f4f7;
  cursor: pointer;
  transition: background 0.15s ease;
}
.field-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.field-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-left: 30px;
}
.field-row-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
.field-row-tools .icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #646a73;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.field-row-tools .icon-btn:hover:not(:disabled) {
  background: #f2f3f5;
  color: #1f2329;
}
.field-row-tools .icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.field-row-tools .icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.field-row:last-child {
  border-bottom: none;
}
.field-row.selected {
  background: #f0f6ff;
  outline: 1px solid #91caff;
  outline-offset: -1px;
}
.field-row.dep-related {
  background: #f5faff;
}
.field-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #f2f3f5;
  color: #646a73;
  font-size: 11px;
}
.field-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475467;
  cursor: pointer;
}
.condition-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: #fff7e6;
  color: #d46b08;
  font-size: 10px;
}
.icon-btn.danger {
  color: #d4380d;
}
.add-field-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.add-field-row select {
  flex: 1;
  height: 32px;
  border: 1px solid #d0d5dd;
  border-radius: 7px;
}
.empty-tip {
  padding: 14px;
  text-align: center;
}
.field-settings {
  padding: 12px;
  border: 1px solid #d6e4ff;
  border-radius: 10px;
  background: #f7faff;
}
.field-settings-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.condition-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.condition-row select,
.condition-row input {
  flex: 1;
  height: 30px;
  min-width: 0;
  padding: 0 7px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.variable-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.var-chip {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #d6e4ff;
  border-radius: 999px;
  background: #f5f8ff;
  color: #1d6fdc;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.var-chip:hover {
  background: #e8f3ff;
  border-color: #91caff;
}
.var-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.share-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 20px;
  padding: 12px;
  border: 1px solid #eaecf0;
  border-radius: 10px;
}
.builder-inline {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  font-size: 12px;
  color: #475467;
}
.builder-inline select,
.builder-inline input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
}
.builder-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.phone-frame {
  align-self: start;
  position: sticky;
  top: 0;
  width: 300px;
  border: 8px solid #1f2329;
  border-radius: 28px;
  background: #f7f8fa;
  overflow: hidden;
}
.phone-top {
  height: 16px;
  background: #1f2329;
}
.phone-body {
  height: 480px;
  overflow: auto;
  padding: 14px;
  background: #fff;
}
.phone-cover {
  width: 100%;
  height: 100px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 10px;
}
.phone-body h2 {
  margin: 4px 0;
  font-size: 17px;
}
.preview-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 12px 0;
  font-size: 12px;
  color: #344054;
}
.preview-field textarea,
.preview-field input,
.preview-field select {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #e5e6eb;
  border-radius: 7px;
  background: #fafbfc;
  color: #98a2b3;
  font-size: 12px;
  resize: none;
}
.required-star {
  color: #d4380d;
  font-style: normal;
}
.preview-submit {
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: none;
  border-radius: 8px;
  background: #2d8cf0;
  color: #fff;
}
.phone-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border-top: 1px solid #eef0f3;
  color: #98a2b3;
  font-size: 11px;
}
.phone-tip img {
  width: 34px;
  height: 34px;
}
.preview-pane {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.live-preview,
.success-settings {
  padding-top: 4px;
  border-top: 1px solid var(--border, #e5e6eb);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.success-preview {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #eaecf0;
  border-radius: 10px;
  background: #fff;
}
.success-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.live-preview h4,
.success-preview h4 {
  margin: 0;
  font-size: 14px;
}
.success-html {
  min-height: 150px;
  padding: 16px;
  border: 1px solid #eaecf0;
  border-radius: 8px;
  background: #fafbfc;
}
.cover-editor {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cover-editor .cover-preview,
.cover-empty {
  width: 160px;
  height: 72px;
  border-radius: 8px;
  object-fit: cover;
}
.cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #d0d5dd;
  color: #98a2b3;
  font-size: 12px;
}
.cover-actions {
  display: flex;
  gap: 6px;
}
.form-error {
  color: #d92d20;
  font-size: 13px;
  margin: 0;
}
.share-box {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 16px;
  border: 1px solid #d6e4ff;
  background: #f7faff;
  border-radius: 12px;
  padding: 14px 16px;
}
.share-box-main {
  flex: 1;
  min-width: 0;
}
.share-box-title {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #1f2329;
}
.share-url {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-all;
  color: #1849a9;
}
.share-url-box {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
}
.share-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.share-status {
  margin: 10px 0 0;
  font-size: 12px;
  color: #8f959e;
  line-height: 1.4;
}
.share-box-qr {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 112px;
}
.share-qr {
  width: 104px;
  height: 104px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #eaecf0;
}
.share-qr-empty {
  margin: 0;
  max-width: 104px;
  font-size: 11px;
  line-height: 1.4;
  color: #98a2b3;
  text-align: center;
}
.share-dialog-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 12px 0;
}
.hidden-cover-input {
  display: none;
}
.small-text,
.tiny {
  font-size: 12px;
}
.tiny {
  font-size: 11px;
}
.muted {
  color: #667085;
}
@media (max-width: 960px) {
  .builder-layout {
    grid-template-columns: 1fr;
  }
  .phone-frame {
    display: none;
  }
  .preview-pane {
    grid-template-columns: 1fr;
  }
}
</style>
