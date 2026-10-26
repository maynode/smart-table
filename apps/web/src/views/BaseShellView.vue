<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GridPanel from '../components/GridPanel.vue';
import AutomationPanel from '../components/AutomationPanel.vue';
import FormBuilderPanel from '../components/FormBuilderPanel.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import DashboardPanel from '../components/DashboardPanel.vue';
import AnalysisReportPanel from '../components/AnalysisReportPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import PublicViewPanel from '../components/PublicViewPanel.vue';
import NotificationBell from '../components/NotificationBell.vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { confirmDialog, promptDialog } from '../ui/dialog';
import {
  clearEditHistory,
  pushEdit,
  pushRedo,
  pushUndoEntry,
  takeRedo,
  takeUndo,
} from '../ui/edit-history';
import {
  messageCenter,
  syncBannerText,
} from '../sync/message-center';
import { collabSocket, type CollabCursor } from '../sync/collab-socket';
import { liveBus } from '../sync/live-bus';
import { liveSocket } from '../sync/live-socket';
import { auth } from '../stores/auth';
import { newId } from '../ui/id';
import { toast } from '../ui/toast';
import { resolveAvatarSrc } from '../utils/avatar';
import type {
  LiveEvent,
  MutationResult,
  SheetMutation,
  ViewQuery,
} from 'shared';
import type {
  AnalysisReportListItemDto,
  BaseDto,
  CommentDto,
  DashboardDto,
  FieldDto,
  FormDto,
  MemberDto,
  RecordDto,
  SavedViewDto,
  SheetDto,
  TemplateInstantiateResult,
  WorkspaceDto,
} from '../api/types';

const route = useRoute();
const router = useRouter();
const workspaceId = computed(() => String(route.params.workspaceId));
const baseId = computed(() => String(route.params.baseId));

const workspace = ref<WorkspaceDto | null>(null);
/** 工作区角色 ≥ editor：可新建对象 / 改自动化等 */
const canEditByRole = computed(() => {
  const role = workspace.value?.role;
  return role === 'owner' || role === 'admin' || role === 'editor';
});
/** 邀请/内容权限管理：仅 owner|admin */
const canManageMembers = computed(() => {
  const role = workspace.value?.role;
  return role === 'owner' || role === 'admin';
});
/** 当前工作表内容权限档位（everyone/成员覆盖后的 effective） */
const sheetAclLevel = ref<'full' | 'edit' | 'view' | 'none' | null>(null);
/** 当前仪表盘内容权限档位 */
const dashboardAclLevel = ref<'full' | 'edit' | 'view' | 'none' | null>(null);
/** 当前收集表单内容权限档位（按 Form 对象） */
const formAclLevel = ref<'full' | 'edit' | 'view' | 'none' | null>(null);
const canEditDashboard = computed(() => {
  if (!canEditByRole.value) return false;
  const role = workspace.value?.role;
  if (role === 'owner' || role === 'admin') return true;
  const level = dashboardAclLevel.value;
  // null = 加载中/未知：先禁写，避免切换对象时沿用上一张表的 ACL
  if (level == null) return false;
  return level === 'full' || level === 'edit';
});
/**
 * 网格/记录可写：工作区可编辑，且（所有者/管理员 或 对象 ACL ≥ edit）。
 * 对齐后端 assertSheetAccess(editor) + 内容权限 assertCan。
 */
const canEditSheet = computed(() => {
  if (!canEditByRole.value) return false;
  const role = workspace.value?.role;
  if (role === 'owner' || role === 'admin') return true;
  const level = sheetAclLevel.value;
  // null = 加载中/未知：先禁写，避免切换表时短暂可写
  if (level == null) return false;
  return level === 'full' || level === 'edit';
});
/**
 * 表单设计可写：需可写底层 sheet（字段），且已有 Form 时还要 form ACL ≥ edit。
 * 尚无 Form 记录时允许首次创建（后端仅校验 workspace editor）。
 */
const canEditForm = computed(() => {
  if (!canEditSheet.value) return false;
  const role = workspace.value?.role;
  if (role === 'owner' || role === 'admin') return true;
  const sheetId = activeSheet.value?.id;
  if (!sheetId) return false;
  const hasForm = forms.value.some((item) => item.sheetId === sheetId);
  if (!hasForm) return true;
  const level = formAclLevel.value;
  if (level == null) return false;
  return level === 'full' || level === 'edit';
});
const base = ref<BaseDto | null>(null);
const sheets = ref<SheetDto[]>([]);
const forms = ref<FormDto[]>([]);
const dashboards = ref<DashboardDto[]>([]);
const analysisReports = ref<AnalysisReportListItemDto[]>([]);
const activeSheet = ref<SheetDto | null>(null);
const activeDashboardId = ref('');
/**
 * grid：普通工作表网格
 * form：收集表单（编辑/填写）
 * form-results：该表单的提交记录（收集结果，底层仍是表记录网格）
 * dashboard：仪表盘主区
 * analysis：分析报告主区（右侧嵌入，非弹窗）
 */
const mainView = ref<
  'grid' | 'form' | 'form-results' | 'dashboard' | 'analysis'
>('grid');
/** 顶栏「只读」：随当前主区对象权限变化，避免仪表盘可写时仍显示表只读 */
const showReadonlyBanner = computed(() => {
  if (mainView.value === 'dashboard') return !canEditDashboard.value;
  if (mainView.value === 'analysis') return !canEditByRole.value;
  if (mainView.value === 'form') return !canEditForm.value;
  return !canEditSheet.value;
});
/** 从收集结果返回表单时，恢复编辑/填写 Tab */
const formReturnTab = ref<'design' | 'preview'>('design');

const knownFormSheetIds = ref(new Set<string>());
const activeAnalysisReportId = ref('');

const formSheetIds = computed(
  () => new Set(forms.value.map((item) => item.sheetId)),
);

function sheetHasForm(sheetId: string): boolean {
  return (
    formSheetIds.value.has(sheetId) || knownFormSheetIds.value.has(sheetId)
  );
}
const records = ref<RecordDto[]>([]);
const nextCursor = ref<string | null>(null);
/** Large sheet: absolute total for virtual scrollbar (null = small/drain mode). */
const totalRecordCount = ref<number | null>(null);
const recordOffset = ref(0);
const WINDOW_SIZE = 2000;
/** Start fetch before the viewport reaches the buffer edge. */
const WINDOW_PAD = 200;
const PREFETCH_EDGE = 600;
const MAX_INDEX_CACHE = 12000;
const LARGE_SHEET_THRESHOLD = 2000;
/** 静默续拉世代号：切表时递增，丢弃过期批次 */
const recordsLoadGen = ref(0);
/** Absolute row -> record (large-sheet sliding cache). */
const recordIndexCache = new Map<number, RecordDto>();
const recordCacheEpoch = ref(0);
const windowFetchesInFlight = new Map<number, Promise<void>>();
let lastWindowStats: { rows: { start: number; end: number } } | null = null;
const SCROLL_SETTLE_MS = 90;
let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;
const loading = ref(false);
const bootError = ref('');
const rowColors = ref<Record<string, string>>({});
const rowHeightPx = ref(36);
const viewGroups = ref<
  Array<{ fieldId: string; key: string; label: string; count: number }>
>([]);
const gridRef = ref<InstanceType<typeof GridPanel> | null>(null);
const savedViews = ref<SavedViewDto[]>([]);
const savedViewName = ref('');
const currentViewId = ref('');
const currentQuery = ref<ViewQuery>({});
const savingView = ref(false);
const applyingSavedView = ref(false);
const sheetMenuId = ref<string | null>(null);
const moreOpen = ref(false);

const commentsOpen = ref(false);
const comments = ref<CommentDto[]>([]);
const commentDraft = ref('');
const commentSending = ref(false);
const mentionQuery = ref<string | null>(null);
const mentionIndex = ref(0);
const commentMentions = ref<string[]>([]);

const members = ref<MemberDto[]>([]);

const automationsOpen = ref(false);
const formBuilderOpen = ref(false);
const permissionsOpen = ref(false);
const templatesOpen = ref(false);
const publicViewOpen = ref(false);

/** 底部仅保留「导入 / 模板」；工作表等走各分区 + */
const createMenuItems = [
  { icon: '📥', label: '导入表格', action: 'import' as const },
  { icon: '🧩', label: '从模板新建', action: 'template' as const },
];

/** 侧栏分区折叠：仪表盘多时默认收起 */
const sectionCollapsed = ref({
  sheets: false,
  forms: false,
  dashboards: false,
  reports: false,
});

function toggleSection(
  key: 'sheets' | 'forms' | 'dashboards' | 'reports',
): void {
  sectionCollapsed.value = {
    ...sectionCollapsed.value,
    [key]: !sectionCollapsed.value[key],
  };
}

const dataSheets = computed(() =>
  sheets.value.filter((sheet) => !isFormSheet(sheet)),
);
const formSheets = computed(() =>
  sheets.value.filter((sheet) => isFormSheet(sheet)),
);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '网络错误，请稍后重试';
}

function isFormSheet(sheet: SheetDto): boolean {
  return sheetHasForm(sheet.id) || sheet.name === '收集表单';
}

function markFormSheet(sheetId: string): void {
  knownFormSheetIds.value = new Set([...knownFormSheetIds.value, sheetId]);
}

function applyDefaultView(): void {
  currentViewId.value = '';
  savedViewName.value = '';
  gridRef.value?.clearView?.();
}

async function bootstrap(): Promise<void> {
  bootError.value = '';
  try {
    const [
      ws,
      baseDetail,
      sheetList,
      memberList,
      formList,
      dashboardList,
      reportList,
    ] = await Promise.all([
      endpoints.getWorkspace(workspaceId.value),
      endpoints.getBase(baseId.value),
      endpoints.listSheets(baseId.value),
      endpoints.listMembers(workspaceId.value).catch(() => [] as MemberDto[]),
      endpoints.listForms(baseId.value).catch(() => [] as FormDto[]),
      endpoints
        .listDashboards(baseId.value, 'dashboard')
        .catch(() => [] as DashboardDto[]),
      endpoints
        .listAnalysisReports(baseId.value)
        .catch(() => [] as AnalysisReportListItemDto[]),
    ]);
    workspace.value = ws;
    base.value = baseDetail;
    sheets.value = sheetList;
    members.value = memberList;
    forms.value = formList;
    dashboards.value = dashboardList;
    analysisReports.value = reportList;
    if (dashboardList.length > 4) {
      sectionCollapsed.value = {
        ...sectionCollapsed.value,
        dashboards: true,
      };
    }
    if (reportList.length > 4) {
      sectionCollapsed.value = {
        ...sectionCollapsed.value,
        reports: true,
      };
    }

    const requested =
      typeof route.query.sheet === 'string' ? route.query.sheet : null;
    // 默认优先打开码库类工作表；若只有收集表单则进表单视图
    const preferred =
      requested ??
      sheetList.find((sheet) => !isFormSheet(sheet))?.id ??
      sheetList[0]?.id;
    if (preferred) {
      await selectSheet(preferred, false);
    }
  } catch (error) {
    bootError.value = messageOf(error);
  }
}

function onFormSheetUpdated(sheet: SheetDto): void {
  activeSheet.value = sheet;
  sheets.value = sheets.value.map((item) =>
    item.id === sheet.id ? { ...item, fields: sheet.fields } : item,
  );
}

function onFormSaved(form: FormDto): void {
  const exists = forms.value.some((item) => item.id === form.id);
  forms.value = exists
    ? forms.value.map((item) => (item.id === form.id ? form : item))
    : [...forms.value, form];
  markFormSheet(form.sheetId);
  void refreshFormAcl(form.sheetId);
}

async function openFormResults(): Promise<void> {
  if (!activeSheet.value) return;
  mainView.value = 'form-results';
  loading.value = true;
  try {
    const page = await endpoints.listRecords(activeSheet.value.id, null, 100);
    records.value = page.records;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

function backToForm(tab: 'design' | 'preview' = 'preview'): void {
  formReturnTab.value = tab;
  mainView.value = 'form';
}

async function refreshObjectAcl(
  objectType: 'sheet' | 'form' | 'dashboard',
  objectId: string | null,
  target: typeof sheetAclLevel,
): Promise<void> {
  if (!objectId || !canEditByRole.value) {
    target.value = null;
    return;
  }
  const role = workspace.value?.role;
  if (role === 'owner' || role === 'admin') {
    target.value = 'full';
    return;
  }
  // 先清空，避免沿用上一对象档位；加载完成前 canEdit* 为 false
  target.value = null;
  try {
    const detail = await endpoints.getPermissionSettings(objectType, objectId);
    // 切换期间过期响应丢弃
    if (objectType === 'sheet' && activeSheet.value?.id !== objectId) return;
    if (objectType === 'dashboard' && activeDashboardId.value !== objectId) return;
    if (objectType === 'form') {
      const sheetId = activeSheet.value?.id;
      const stillActive =
        sheetId &&
        forms.value.some(
          (item) => item.id === objectId && item.sheetId === sheetId,
        );
      if (!stillActive) return;
    }
    target.value = detail.effective.level;
  } catch {
    // 拉取失败按仅浏览，禁止前端写入口（后端仍会 403）
    if (objectType === 'sheet' && activeSheet.value?.id !== objectId) return;
    if (objectType === 'dashboard' && activeDashboardId.value !== objectId) return;
    if (objectType === 'form') {
      const sheetId = activeSheet.value?.id;
      const stillActive =
        sheetId &&
        forms.value.some(
          (item) => item.id === objectId && item.sheetId === sheetId,
        );
      if (!stillActive) return;
    }
    target.value = 'view';
  }
}

async function refreshSheetAcl(sheetId: string | null): Promise<void> {
  await refreshObjectAcl('sheet', sheetId, sheetAclLevel);
}

async function refreshDashboardAcl(dashboardId: string | null): Promise<void> {
  await refreshObjectAcl('dashboard', dashboardId, dashboardAclLevel);
}

async function refreshFormAcl(sheetId: string | null): Promise<void> {
  if (!sheetId) {
    formAclLevel.value = null;
    return;
  }
  const form = forms.value.find((item) => item.sheetId === sheetId);
  if (!form) {
    formAclLevel.value = null;
    return;
  }
  await refreshObjectAcl('form', form.id, formAclLevel);
}

async function selectSheet(sheetId: string, push = true): Promise<void> {
  if (push && route.query.sheet !== sheetId) {
    await router.replace({ query: { ...route.query, sheet: sheetId } });
  }
  loading.value = true;
  try {
    const [detail, views] = await Promise.all([
      endpoints.getSheet(sheetId),
      endpoints.listSavedViews(sheetId).catch(() => [] as SavedViewDto[]),
    ]);
    if (activeSheet.value?.id !== sheetId) {
      clearEditHistory();
    }
    activeDashboardId.value = '';
    activeAnalysisReportId.value = '';
    dashboardAclLevel.value = null;
    formAclLevel.value = null;
    activeSheet.value = detail;
    sheetAclLevel.value = null;
    void refreshSheetAcl(sheetId);
    void refreshFormAcl(sheetId);
    // 企微：收集表单默认进表单 UI；提交数据在「收集结果」里看
    if (isFormSheet(detail)) {
      sectionCollapsed.value = { ...sectionCollapsed.value, forms: false };
      mainView.value = 'form';
      formBuilderOpen.value = false;
      savedViews.value = views;
      currentViewId.value = '';
      currentQuery.value = {};
      savedViewName.value = '';
      rowColors.value = {};
      viewGroups.value = [];
      records.value = [];
      nextCursor.value = null;
      totalRecordCount.value = null;
      recordOffset.value = 0;
      clearRecordWindowCache();
      messageCenter.attachSheet(null);
      return;
    }
    sectionCollapsed.value = { ...sectionCollapsed.value, sheets: false };
    mainView.value = 'grid';
    savedViews.value = views;
    currentViewId.value = '';
    currentQuery.value = {};
    savedViewName.value = '';
    rowColors.value = {};
    viewGroups.value = [];
    recordsLoadGen.value += 1;
    const page = await endpoints.listRecords(sheetId, null, WINDOW_SIZE, 0);
    clearRecordWindowCache();
    records.value = page.records;
    recordOffset.value = 0;
    const total = page.total ?? page.records.length;
    if (total > LARGE_SHEET_THRESHOLD) {
      totalRecordCount.value = total;
      nextCursor.value = null;
      putRecordWindow(0, page.records, 0);
    } else {
      totalRecordCount.value = null;
      nextCursor.value = page.nextCursor;
      void drainRecordsInBackground(sheetId);
    }
    messageCenter.attachSheet(sheetId);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.query.sheet,
  (value) => {
    if (typeof value === 'string' && value !== activeSheet.value?.id) {
      void selectSheet(value, false);
    }
  },
);

watch(
  records,
  (value) => {
    (
      window as unknown as {
        __stRecordsProbe?: typeof value;
      }
    ).__stRecordsProbe = value;
  },
  { deep: true, immediate: true },
);

async function addRow(): Promise<void> {
  await insertRows({ count: 1, direction: 'below' });
}

async function insertRows(payload: {
  count: number;
  direction: 'above' | 'below';
  atIndex?: number;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法添加记录');
    return;
  }
  if (!activeSheet.value) return;
  const count = Math.min(100, Math.max(1, Math.floor(payload.count || 1)));
  const sheetId = activeSheet.value.id;
  try {
    const created: RecordDto[] = [];
    for (let i = 0; i < count; i += 1) {
      const clientRecordId = newId();
      const temp: RecordDto = {
        id: clientRecordId,
        sheetId,
        cells: {},
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      created.push(temp);
      await messageCenter.enqueue(sheetId, {
        type: 'createRecord',
        clientRecordId,
        cells: {},
      });
    }
    if (typeof payload.atIndex === 'number') {
      const index = Math.max(
        0,
        Math.min(records.value.length, Math.floor(payload.atIndex)),
      );
      records.value = [
        ...records.value.slice(0, index),
        ...created,
        ...records.value.slice(index),
      ];
    } else {
      records.value = [...records.value, ...created];
    }
    toast(count === 1 ? '已添加一行' : `已添加 ${count} 行`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function insertColumns(payload: {
  count: number;
  direction: 'left' | 'right';
  fieldId: string;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法修改字段');
    return;
  }
  if (!activeSheet.value) return;
  const target = (activeSheet.value.fields ?? []).find(
    (field) => field.id === payload.fieldId,
  );
  if (!target) return;
  const count = Math.min(20, Math.max(1, Math.floor(payload.count || 1)));
  const order =
    payload.direction === 'left' ? target.order : target.order + 1;
  const usedNames = new Set(
    (activeSheet.value.fields ?? []).map((field) => field.name),
  );
  const nextName = (): string => {
    const base = '文本';
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let index = 2;
    while (usedNames.has(`${base} ${index}`)) index += 1;
    const name = `${base} ${index}`;
    usedNames.add(name);
    return name;
  };
  try {
    for (let i = 0; i < count; i += 1) {
      await endpoints.createField(activeSheet.value.id, {
        name: nextName(),
        type: 'text',
        options: { width: 180 },
        order,
      });
    }
    await selectSheet(activeSheet.value.id, false);
    toast(count === 1 ? '已插入一列' : `已插入 ${count} 列`);
  } catch (error) {
    toast(messageOf(error));
  }
}

function coerceCellValue(field: FieldDto, value: string): unknown {
  if (field.type === 'checkbox') {
    return value === 'true' || value === '1';
  }
  if (
    field.type === 'number' ||
    field.type === 'currency' ||
    field.type === 'percent' ||
    field.type === 'progress'
  ) {
    if (value.trim() === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }
  if (field.type === 'multiSelect') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'string') return value.slice(0, 24);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, 24);
  } catch {
    return '…';
  }
}

async function commitCell(payload: {
  record: RecordDto;
  field: FieldDto;
  value: unknown;
  previous?: unknown;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法编辑');
    return;
  }
  if (!activeSheet.value) return;
  const coerced =
    typeof payload.value === 'string'
      ? coerceCellValue(payload.field, payload.value)
      : payload.value;
  const previous =
    payload.previous !== undefined
      ? payload.previous
      : payload.record.cells[payload.field.id];
  // 乐观本地应用；MessageCenter 持久化后 flush
  records.value = records.value.map((record) =>
    record.id === payload.record.id
      ? {
          ...record,
          cells: { ...record.cells, [payload.field.id]: coerced },
          version: record.version,
        }
      : record,
  );
  pushEdit({
    sheetId: activeSheet.value.id,
    recordId: payload.record.id,
    fieldId: payload.field.id,
    fieldName: payload.field.name,
    previous,
    next: coerced,
    label: `${payload.field.name}: ${formatHistoryValue(previous)} → ${formatHistoryValue(coerced)}`,
  });
  try {
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'setRecord',
      recordId: payload.record.id,
      cells: { [payload.field.id]: coerced },
      baseVersion: payload.record.version,
    });
  } catch (error) {
    toast(messageOf(error));
  }
}

function onCommitAccept(results: MutationResult[]): void {
  for (const result of results) {
    if (result.status !== 'ok' && result.status !== 'duplicate') continue;
    if (result.record) {
      const rec = result.record;
      records.value = records.value.map((item) =>
        item.id === rec.id
          ? {
              ...item,
              id: rec.id,
              cells: rec.cells,
              version: rec.version,
            }
          : item,
      );
    }
    if (result.recordIdMap) {
      for (const [clientId, serverId] of Object.entries(result.recordIdMap)) {
        records.value = records.value.map((item) =>
          item.id === clientId ? { ...item, id: serverId } : item,
        );
      }
    }
    if (result.fieldIdMap && activeSheet.value) {
      for (const [clientId, serverId] of Object.entries(result.fieldIdMap)) {
        activeSheet.value = {
          ...activeSheet.value,
          fields: (activeSheet.value.fields ?? []).map((field) =>
            field.id === clientId ? { ...field, id: serverId } : field,
          ),
        };
      }
    }
    if (result.field && activeSheet.value) {
      const f = result.field;
      activeSheet.value = {
        ...activeSheet.value,
        fields: (activeSheet.value.fields ?? []).map((field) =>
          field.id === f.id
            ? {
                ...field,
                name: f.name,
                type: f.type,
                options: (f.options as FieldDto['options']) ?? field.options,
                order: f.order ?? field.order,
                required: f.required ?? field.required,
                hidden: f.hidden ?? field.hidden,
              }
            : field,
        ),
      };
    }
  }
}

function applyRemoteMutations(mutations: SheetMutation[]): void {
  for (const mutation of mutations) {
    if (mutation.type === 'setRecord') {
      records.value = records.value.map((item) => {
        if (item.id !== mutation.recordId) return item;
        return {
          ...item,
          cells: { ...item.cells, ...mutation.cells },
          version: item.version + 1,
        };
      });
      continue;
    }
    if (mutation.type === 'createRecord') {
      const id = mutation.clientRecordId;
      if (records.value.some((r) => r.id === id)) continue;
      records.value = [
        ...records.value,
        {
          id,
          sheetId: activeSheet.value?.id ?? '',
          cells: mutation.cells ?? {},
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      continue;
    }
    if (mutation.type === 'deleteRecord') {
      records.value = records.value.filter((r) => r.id !== mutation.recordId);
      continue;
    }
    if (mutation.type === 'deleteField' && activeSheet.value) {
      activeSheet.value = {
        ...activeSheet.value,
        fields: (activeSheet.value.fields ?? []).filter(
          (f) => f.id !== mutation.fieldId,
        ),
      };
      continue;
    }
    if (mutation.type === 'createField' && activeSheet.value) {
      const exists = (activeSheet.value.fields ?? []).some(
        (f) => f.id === mutation.clientFieldId,
      );
      if (exists) continue;
      activeSheet.value = {
        ...activeSheet.value,
        fields: [
          ...(activeSheet.value.fields ?? []),
          {
            id: mutation.clientFieldId,
            sheetId: activeSheet.value.id,
            name: mutation.name,
            type: mutation.fieldType,
            options: (mutation.options as FieldDto['options']) ?? null,
            order: activeSheet.value.fields?.length ?? 0,
            required: mutation.required ?? false,
            hidden: false,
          },
        ],
      };
      continue;
    }
    if (mutation.type === 'updateField' && activeSheet.value) {
      activeSheet.value = {
        ...activeSheet.value,
        fields: (activeSheet.value.fields ?? []).map((field) =>
          field.id === mutation.fieldId
            ? {
                ...field,
                name: mutation.name ?? field.name,
                options:
                  (mutation.options as FieldDto['options']) ?? field.options,
                required: mutation.required ?? field.required,
                hidden: mutation.hidden ?? field.hidden,
              }
            : field,
        ),
      };
    }
  }
}

function onPeerCursor(cursor: {
  recordId?: string;
  fieldId?: string;
  rowIndex?: number;
  colIndex?: number;
}): void {
  collabSocket.sendCursor(cursor);
}

const selfUserId = computed(() => auth.state.user?.id ?? '');
/** 只展示他人光标；自己的选区不必画 */
function acquireCellLockForGrid(recordId: string, fieldId: string) {
  return collabSocket.acquireCellLock(recordId, fieldId);
}

function releaseCellLockForGrid(recordId: string, fieldId: string): void {
  collabSocket.releaseCellLock(recordId, fieldId);
}

const peerCellLocks = computed(() =>
  collabSocket.cellLocks.value.filter(
    (l) => l.userId && l.userId !== selfUserId.value,
  ),
);

const peerCursors = computed(() =>
  (collabSocket.cursors.value as CollabCursor[]).filter(
    (c) => c.userId && c.userId !== selfUserId.value,
  ),
);
/** 在线名单含自己（人数 = 房内去重后的总人数） */
const collabPeers = computed(() => collabSocket.peers.value);

async function reloadActiveRecords(): Promise<void> {
  if (!activeSheet.value) return;
  try {
    const page = await endpoints.listRecords(activeSheet.value.id, null, 100);
    records.value = page.records;
    nextCursor.value = page.nextCursor;
  } catch (reloadError) {
    toast(messageOf(reloadError));
  }
}

async function applyHistoryValue(
  recordId: string,
  fieldId: string,
  value: unknown,
): Promise<boolean> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法撤销/重做');
    return false;
  }
  const record = records.value.find((item) => item.id === recordId);
  if (!record || !activeSheet.value) {
    toast('记录已不存在，无法撤销/重做');
    return false;
  }
  records.value = records.value.map((item) =>
    item.id === recordId
      ? { ...item, cells: { ...item.cells, [fieldId]: value } }
      : item,
  );
  try {
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'setRecord',
      recordId,
      cells: { [fieldId]: value },
      baseVersion: record.version,
    });
    return true;
  } catch (error) {
    toast(messageOf(error));
    return false;
  }
}

async function undoEdit(): Promise<void> {
  const entry = takeUndo();
  if (!entry) return;
  const ok = await applyHistoryValue(
    entry.recordId,
    entry.fieldId,
    entry.previous,
  );
  if (!ok) {
    pushUndoEntry(entry);
    return;
  }
  pushRedo(entry);
  toast('已撤销');
}

async function redoEdit(): Promise<void> {
  const entry = takeRedo();
  if (!entry) return;
  const ok = await applyHistoryValue(entry.recordId, entry.fieldId, entry.next);
  if (!ok) {
    pushRedo(entry);
    return;
  }
  pushUndoEntry(entry);
  toast('已重做');
}

async function refreshSheet(): Promise<void> {
  if (!activeSheet.value) return;
  await selectSheet(activeSheet.value.id, false);
  toast('已刷新');
}

function clearRecordWindowCache(): void {
  recordIndexCache.clear();
  windowFetchesInFlight.clear();
  lastWindowStats = null;
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
  scrollSettleTimer = null;
  recordCacheEpoch.value = 0;
}

function lookupRecord(row: number): RecordDto | undefined {
  return recordIndexCache.get(row);
}

function trimRecordIndexCache(anchor: number): void {
  if (recordIndexCache.size <= MAX_INDEX_CACHE) return;
  const ranked = [...recordIndexCache.keys()].sort(
    (a, b) => Math.abs(a - anchor) - Math.abs(b - anchor),
  );
  const keep = new Set(ranked.slice(0, MAX_INDEX_CACHE));
  for (const key of recordIndexCache.keys()) {
    if (!keep.has(key)) recordIndexCache.delete(key);
  }
}

function putRecordWindow(offset: number, list: RecordDto[], anchor: number): void {
  for (let i = 0; i < list.length; i += 1) {
    recordIndexCache.set(offset + i, list[i]!);
  }
  trimRecordIndexCache(anchor);
  recordCacheEpoch.value += 1;
}

/** Contiguous dense window for selection/edit; paint prefers lookupRecord. */
function materializeRecordWindow(vStart: number, vEnd: number): void {
  if (recordIndexCache.size === 0) return;
  let start = Math.max(0, vStart);
  while (start > 0 && recordIndexCache.has(start - 1)) start -= 1;
  while (start < vEnd && !recordIndexCache.has(start)) start += 1;
  if (!recordIndexCache.has(start)) return;
  const out: RecordDto[] = [];
  let i = start;
  while (recordIndexCache.has(i) && out.length < MAX_INDEX_CACHE) {
    out.push(recordIndexCache.get(i)!);
    i += 1;
  }
  if (
    start === recordOffset.value &&
    out.length === records.value.length &&
    out[0] === records.value[0] &&
    out[out.length - 1] === records.value[out.length - 1]
  ) {
    return;
  }
  records.value = out;
  recordOffset.value = start;
}

function clampWindowOffset(total: number, preferred: number): number {
  const maxOffset = Math.max(0, total - WINDOW_SIZE);
  return Math.max(0, Math.min(maxOffset, preferred));
}

function cacheContiguousEnd(from: number): number {
  let i = from;
  while (recordIndexCache.has(i)) i += 1;
  return i;
}

function cacheContiguousStart(from: number): number {
  let i = from;
  while (i > 0 && recordIndexCache.has(i - 1)) i -= 1;
  return recordIndexCache.has(i) ? i : from;
}

function pageAlreadyCached(offset: number): boolean {
  let hit = 0;
  const probe = Math.min(48, WINDOW_SIZE);
  for (let i = 0; i < probe; i += 1) {
    if (recordIndexCache.has(offset + i)) hit += 1;
  }
  return hit >= probe - 2;
}

function fetchRecordWindow(sheetId: string, offset: number, anchor: number): Promise<void> {
  if (offset < 0) return Promise.resolve();
  if (pageAlreadyCached(offset)) return Promise.resolve();
  const existing = windowFetchesInFlight.get(offset);
  if (existing) return existing;
  const gen = recordsLoadGen.value;
  const task = (async () => {
    try {
      const prev = offset > 0 ? recordIndexCache.get(offset - 1) : undefined;
      const page = prev
        ? await endpoints.listRecords(sheetId, prev.id, WINDOW_SIZE)
        : await endpoints.listRecords(sheetId, null, WINDOW_SIZE, offset);
      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) return;
      const appliedOffset = prev ? offset : (page.offset ?? offset);
      putRecordWindow(appliedOffset, page.records, anchor);
      const stats = lastWindowStats;
      if (stats) materializeRecordWindow(stats.rows.start, stats.rows.end);
      else materializeRecordWindow(anchor, anchor + 1);
    } catch {
      /* keep cache */
    } finally {
      windowFetchesInFlight.delete(offset);
    }
  })();
  windowFetchesInFlight.set(offset, task);
  return task;
}

function scheduleJumpFetch(sheetId: string, total: number): void {
  if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => {
    scrollSettleTimer = null;
    if (totalRecordCount.value == null || activeSheet.value?.id !== sheetId) return;
    const live = lastWindowStats;
    if (!live) return;
    const mid = Math.floor((live.rows.start + live.rows.end) / 2);
    const primary = clampWindowOffset(total, mid - Math.floor(WINDOW_SIZE / 2));
    void fetchRecordWindow(sheetId, primary, mid);
  }, SCROLL_SETTLE_MS);
}

async function ensureRecordWindow(stats: { rows: { start: number; end: number } }): Promise<void> {
  if (totalRecordCount.value == null || !activeSheet.value) return;
  const total = totalRecordCount.value;
  const sheetId = activeSheet.value.id;
  lastWindowStats = stats;
  materializeRecordWindow(stats.rows.start, stats.rows.end);

  const viewStart = stats.rows.start;
  const viewEnd = stats.rows.end;
  const mid = Math.floor((viewStart + viewEnd) / 2);

  // Contiguous loaded span intersecting viewport (or nearest below).
  let haveStart = recordOffset.value;
  let haveEnd = recordOffset.value + records.value.length;
  if (recordIndexCache.has(viewStart)) {
    haveStart = cacheContiguousStart(viewStart);
    haveEnd = cacheContiguousEnd(viewStart);
  } else if (records.value.length > 0) {
    haveStart = recordOffset.value;
    haveEnd = recordOffset.value + records.value.length;
  }

  const covered = haveEnd > haveStart && viewStart >= haveStart && viewEnd <= haveEnd;
  const gapAhead = viewStart > haveEnd + WINDOW_SIZE;
  const gapBehind = viewEnd < haveStart - WINDOW_SIZE;

  // Big scrollbar jump → one OFFSET after settle (deep skip is expensive).
  if (gapAhead || gapBehind) {
    scheduleJumpFetch(sheetId, total);
    return;
  }

  // Continuous scroll: ALWAYS extend from the unloaded edge via keyset.
  // Root bug was prefetching haveEnd-PAD (already cached) → never fetched ahead.
  if (viewEnd + PREFETCH_EDGE >= haveEnd) {
    void fetchRecordWindow(sheetId, haveEnd, mid);
    void fetchRecordWindow(sheetId, haveEnd + WINDOW_SIZE, mid);
  }
  if (viewStart - PREFETCH_EDGE <= haveStart) {
    const back = clampWindowOffset(total, haveStart - WINDOW_SIZE);
    void fetchRecordWindow(sheetId, back, mid);
  }
  if (!covered) {
    if (viewStart >= haveEnd) void fetchRecordWindow(sheetId, haveEnd, mid);
    if (viewEnd <= haveStart) {
      void fetchRecordWindow(sheetId, clampWindowOffset(total, haveStart - WINDOW_SIZE), mid);
    }
  }
}

async function drainRecordsInBackground(sheetId: string): Promise<void> {
  const gen = ++recordsLoadGen.value;
  let cursor = nextCursor.value;
  while (cursor && gen === recordsLoadGen.value && activeSheet.value?.id === sheetId) {
    try {
      const page = await endpoints.listRecords(sheetId, cursor, 2000);
      if (gen !== recordsLoadGen.value || activeSheet.value?.id !== sheetId) {
        return;
      }
      records.value = [...records.value, ...page.records];
      nextCursor.value = page.nextCursor;
      cursor = page.nextCursor;
    } catch {
      return;
    }
  }
}

async function loadMore(): Promise<void> {
  if (!activeSheet.value || !nextCursor.value || loading.value) return;
  // 触发后台拉齐即可；滚动触底时也走同一路径
  void drainRecordsInBackground(activeSheet.value.id);
}

async function toggleField(payload: {
  field: FieldDto;
  hidden: boolean;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法修改字段');
    return;
  }
  if (!activeSheet.value) return;
  if (activeSheet.value) {
    activeSheet.value = {
      ...activeSheet.value,
      fields: (activeSheet.value.fields ?? []).map((field) =>
        field.id === payload.field.id
          ? { ...field, hidden: payload.hidden }
          : field,
      ),
    };
  }
  try {
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'updateField',
      fieldId: payload.field.id,
      hidden: payload.hidden,
    });
  } catch (error) {
    toast(messageOf(error));
  }
}

async function createField(payload: {
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法添加字段');
    return;
  }
  if (!activeSheet.value) return;
  const clientFieldId = newId();
  const created: FieldDto = {
    id: clientFieldId,
    name: payload.name,
    type: payload.type,
    options: payload.options ?? null,
    order: (activeSheet.value.fields ?? []).length,
    required: false,
    hidden: false,
  };
  activeSheet.value = {
    ...activeSheet.value,
    fields: [...(activeSheet.value.fields ?? []), created],
  };
  toast(`已添加字段「${created.name}」`);
  try {
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'createField',
      clientFieldId,
      name: payload.name,
      fieldType: payload.type,
      options: payload.options ?? null,
    });
  } catch (error) {
    toast(messageOf(error));
  }
  if (
    created.type === 'relation' ||
    created.type === 'formula' ||
    created.type === 'lookup' ||
    created.type === 'ai'
  ) {
    gridRef.value?.openFieldOptions?.(created);
  }
}

async function updateFieldMeta(payload: {
  field: FieldDto;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法修改字段');
    return;
  }
  if (!activeSheet.value) return;
  const patch: {
    name?: string;
    options?: Record<string, unknown> | null;
  } = {};
  if (payload.name !== payload.field.name) patch.name = payload.name;
  if (payload.options !== undefined) patch.options = payload.options;
  if (Object.keys(patch).length === 0) return;

  activeSheet.value = {
    ...activeSheet.value,
    fields: (activeSheet.value.fields ?? []).map((field) =>
      field.id === payload.field.id
        ? {
            ...field,
            name: payload.name,
            type: payload.type,
            options: payload.options ?? field.options,
          }
        : field,
    ),
  };
  toast(`已更新字段「${payload.name}」`);
  try {
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'updateField',
      fieldId: payload.field.id,
      name: patch.name,
      options: patch.options,
    });
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteField(field: FieldDto): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法删除字段');
    return;
  }
  if (!activeSheet.value) return;
  try {
    activeSheet.value = {
      ...activeSheet.value,
      fields: (activeSheet.value.fields ?? []).filter(
        (item) => item.id !== field.id,
      ),
    };
    records.value = records.value.map((record) => {
      const cells = { ...record.cells };
      delete cells[field.id];
      return { ...record, cells };
    });
    await messageCenter.enqueue(activeSheet.value.id, {
      type: 'deleteField',
      fieldId: field.id,
    });
    toast(`已删除字段「${field.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteRecords(recordIds: string[]): Promise<void> {
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法删除记录');
    return;
  }
  if (!activeSheet.value || recordIds.length === 0) return;
  const sheetId = activeSheet.value.id;
  try {
    records.value = records.value.filter(
      (record) => !recordIds.includes(record.id),
    );
    for (const recordId of recordIds) {
      await messageCenter.enqueue(sheetId, {
        type: 'deleteRecord',
        recordId,
      });
    }
    toast(`已删除 ${recordIds.length} 条记录`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function uploadToSheet(file: File) {
  if (!activeSheet.value) throw new Error('no active sheet');
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法上传附件');
    throw new Error('只读');
  }
  if (!navigator.onLine) {
    const blobId = newId();
    const { idbPutBlob } = await import('../sync/idb-store');
    await idbPutBlob(blobId, file, {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sheetId: activeSheet.value.id,
    });
    return {
      url: `pending-blob:${blobId}`,
      name: file.name,
      mimetype: file.type,
      size: file.size,
      pendingBlobId: blobId,
    };
  }
  return endpoints.uploadAttachment(activeSheet.value.id, file);
}

async function renameSheet(sheet: SheetDto): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法重命名');
    return;
  }
  const name = (await promptDialog('重命名工作表', sheet.name))?.trim();
  if (!name || name === sheet.name) return;
  try {
    const updated = await endpoints.updateSheet(sheet.id, name);
    if (activeSheet.value?.id === sheet.id) {
      activeSheet.value = { ...activeSheet.value, ...updated };
    }
    sheets.value = sheets.value.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item,
    );
    toast(`已重命名为「${updated.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteSheet(sheet: SheetDto): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法删除');
    return;
  }
  const ok = await confirmDialog(
    `删除工作表「${sheet.name}」及其全部记录？此操作不可撤销。`,
    { title: '删除工作表', confirmLabel: '删除' },
  );
  if (!ok) return;
  try {
    await endpoints.deleteSheet(sheet.id);
    const wasActive = activeSheet.value?.id === sheet.id;
    sheets.value = sheets.value.filter((item) => item.id !== sheet.id);
    toast(`已删除工作表「${sheet.name}」`);
    if (!wasActive) return;
    activeSheet.value = null;
    records.value = [];
    nextCursor.value = null;
    savedViews.value = [];
    const next = sheets.value[0];
    if (next) {
      await selectSheet(next.id);
    } else {
      await router.replace({ query: { ...route.query, sheet: undefined } });
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

async function renameActiveSheet(): Promise<void> {
  moreOpen.value = false;
  if (!activeSheet.value) {
    toast('请先选择一张工作表');
    return;
  }
  await renameSheet(activeSheet.value);
}

async function deleteActiveSheet(): Promise<void> {
  moreOpen.value = false;
  if (!activeSheet.value) {
    toast('请先选择一张工作表');
    return;
  }
  await deleteSheet(activeSheet.value);
}

async function saveCurrentView(): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法保存视图');
    return;
  }
  if (!activeSheet.value || savingView.value) return;
  const name = savedViewName.value.trim();
  if (!name) {
    toast('请先输入视图名称');
    return;
  }
  savingView.value = true;
  try {
    const created = await endpoints.createSavedView(activeSheet.value.id, {
      name,
      query: currentQuery.value,
    });
    savedViews.value = [...savedViews.value, created];
    currentViewId.value = created.id;
    savedViewName.value = '';
    toast(`已保存视图「${created.name}」`);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    savingView.value = false;
  }
}

function applySavedView(view: SavedViewDto): void {
  currentViewId.value = view.id;
  savedViewName.value = view.name;
  applyingSavedView.value = true;
  gridRef.value?.applySavedQuery(view.query);
  window.setTimeout(() => {
    applyingSavedView.value = false;
  }, 0);
}

async function renameSavedView(view: SavedViewDto): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法重命名视图');
    return;
  }
  const name = (await promptDialog('重命名视图', view.name))?.trim();
  if (!name || name === view.name) return;
  try {
    const updated = await endpoints.updateSavedView(view.id, { name });
    savedViews.value = savedViews.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
    if (currentViewId.value === updated.id) savedViewName.value = updated.name;
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteSavedView(view: SavedViewDto): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法删除视图');
    return;
  }
  const ok = await confirmDialog(`删除视图「${view.name}」？`, {
    title: '删除视图',
    confirmLabel: '删除',
  });
  if (!ok) return;
  try {
    await endpoints.deleteSavedView(view.id);
    savedViews.value = savedViews.value.filter((item) => item.id !== view.id);
    if (currentViewId.value === view.id) {
      currentViewId.value = '';
      savedViewName.value = '';
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

function onQueryChange(query: ViewQuery): void {
  currentQuery.value = JSON.parse(JSON.stringify(query)) as ViewQuery;
  if (!applyingSavedView.value) {
    currentViewId.value = '';
    savedViewName.value = '';
  }
}

async function openOrCreateFormSheet(): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法新建表单');
    return;
  }
  sectionCollapsed.value = { ...sectionCollapsed.value, forms: false };
  const formCount = sheets.value.filter((sheet) => isFormSheet(sheet)).length;
  const defaultName =
    formCount === 0 ? '收集表单' : `收集表单 ${formCount + 1}`;
  const name = (await promptDialog('新收集表单名称', defaultName))?.trim();
  if (!name) return;
  try {
    const sheet = await endpoints.createSheet(baseId.value, name);
    sheets.value = [...sheets.value, sheet];
    markFormSheet(sheet.id);
    // 尚无 Form 记录时靠本地标记识别为表单视图；保存后 listForms 会挂上
    mainView.value = 'form';
    await selectSheet(sheet.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

function openAnalysisReport(reportId: string): void {
  sectionCollapsed.value = { ...sectionCollapsed.value, reports: false };
  activeAnalysisReportId.value = reportId;
  activeDashboardId.value = '';
  mainView.value = 'analysis';
  sheetMenuId.value = null;
}

function closeAnalysisReport(): void {
  activeAnalysisReportId.value = '';
  if (mainView.value === 'analysis') {
    const sheet = activeSheet.value;
    if (sheet && isFormSheet(sheet)) {
      mainView.value = 'form';
    } else if (sheet) {
      mainView.value = 'grid';
    } else if (activeDashboardId.value) {
      mainView.value = 'dashboard';
    } else {
      mainView.value = 'grid';
    }
  }
}

function onAnalysisReportCreated(reportId: string): void {
  void endpoints
    .listAnalysisReports(baseId.value)
    .then((list) => {
      analysisReports.value = list;
    })
    .catch(() => undefined);
  openAnalysisReport(reportId);
}

async function createAnalysisReport(): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法新建分析报告');
    return;
  }
  sectionCollapsed.value = { ...sectionCollapsed.value, reports: false };
  const defaultName = '分析报告';
  const name = (await promptDialog('新分析报告名称', defaultName))?.trim();
  if (!name) return;
  try {
    const created = await endpoints.createAnalysisReport(baseId.value, name);
    analysisReports.value = [
      {
        id: created.id,
        baseId: created.baseId,
        name: created.name,
        status: created.status,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      ...analysisReports.value,
    ];
    openAnalysisReport(created.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function createSheet(): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法新建工作表');
    return;
  }
  sectionCollapsed.value = { ...sectionCollapsed.value, sheets: false };
  const name = (await promptDialog('新工作表名称', '新工作表'))?.trim();
  if (!name) return;
  try {
    const sheet = await endpoints.createSheet(baseId.value, name);
    sheets.value = [...sheets.value, sheet];
    await selectSheet(sheet.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

function openDashboard(dashboardId: string): void {
  sectionCollapsed.value = { ...sectionCollapsed.value, dashboards: false };
  activeDashboardId.value = dashboardId;
  activeAnalysisReportId.value = '';
  mainView.value = 'dashboard';
  sheetMenuId.value = null;
  dashboardAclLevel.value = null;
  void refreshDashboardAcl(dashboardId);
}

async function createDashboard(): Promise<void> {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法新建仪表盘');
    return;
  }
  sectionCollapsed.value = { ...sectionCollapsed.value, dashboards: false };
  const defaultName = `仪表盘 ${dashboards.value.length + 1}`;
  const name = (await promptDialog('新仪表盘名称', defaultName))?.trim();
  if (!name) return;
  try {
    const created = await endpoints.createDashboard(baseId.value, {
      name,
      kind: 'dashboard',
    });
    dashboards.value = [...dashboards.value, created];
    openDashboard(created.id);
    toast('已创建仪表盘');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function renameDashboard(dashboard: DashboardDto): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法重命名');
    return;
  }
  const name = (await promptDialog('重命名仪表盘', dashboard.name))?.trim();
  if (!name || name === dashboard.name) return;
  try {
    const updated = await endpoints.updateDashboard(dashboard.id, name);
    dashboards.value = dashboards.value.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item,
    );
    toast(`已重命名为「${updated.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteDashboard(dashboard: DashboardDto): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法删除');
    return;
  }
  const ok = await confirmDialog(
    `删除仪表盘「${dashboard.name}」及其全部图表？此操作不可撤销。`,
    { title: '删除仪表盘', confirmLabel: '删除' },
  );
  if (!ok) return;
  try {
    await endpoints.deleteDashboard(dashboard.id);
    const wasActive =
      mainView.value === 'dashboard' &&
      activeDashboardId.value === dashboard.id;
    dashboards.value = dashboards.value.filter((item) => item.id !== dashboard.id);
    toast(`已删除仪表盘「${dashboard.name}」`);
    if (!wasActive) return;
    activeDashboardId.value = '';
    const next = dashboards.value[0];
    if (next) {
      openDashboard(next.id);
    } else if (activeSheet.value) {
      mainView.value = isFormSheet(activeSheet.value) ? 'form' : 'grid';
    } else {
      mainView.value = 'grid';
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

async function renameAnalysisReport(
  report: AnalysisReportListItemDto,
): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法重命名');
    return;
  }
  const name = (await promptDialog('重命名分析报告', report.name))?.trim();
  if (!name || name === report.name) return;
  try {
    const updated = await endpoints.updateAnalysisReport(report.id, name);
    analysisReports.value = analysisReports.value.map((item) =>
      item.id === updated.id
        ? {
            ...item,
            name: updated.name,
            updatedAt: updated.updatedAt,
          }
        : item,
    );
    toast(`已重命名为「${updated.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteAnalysisReport(
  report: AnalysisReportListItemDto,
): Promise<void> {
  sheetMenuId.value = null;
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法删除');
    return;
  }
  const ok = await confirmDialog(
    `删除分析报告「${report.name}」？此操作不可撤销。`,
    { title: '删除分析报告', confirmLabel: '删除' },
  );
  if (!ok) return;
  try {
    await endpoints.deleteAnalysisReport(report.id);
    const wasActive =
      mainView.value === 'analysis' &&
      activeAnalysisReportId.value === report.id;
    analysisReports.value = analysisReports.value.filter(
      (item) => item.id !== report.id,
    );
    toast(`已删除分析报告「${report.name}」`);
    if (!wasActive) return;
    activeAnalysisReportId.value = '';
    const next = analysisReports.value[0];
    if (next) {
      openAnalysisReport(next.id);
    } else if (activeDashboardId.value) {
      mainView.value = 'dashboard';
    } else if (activeSheet.value) {
      mainView.value = isFormSheet(activeSheet.value) ? 'form' : 'grid';
    } else {
      mainView.value = 'grid';
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

async function openComments(): Promise<void> {
  commentsOpen.value = true;
  if (!activeSheet.value) return;
  try {
    const [list, memberList] = await Promise.all([
      endpoints.listComments(activeSheet.value.id),
      members.value.length
        ? Promise.resolve(members.value)
        : endpoints.listMembers(workspaceId.value),
    ]);
    comments.value = list;
    if (!members.value.length) members.value = memberList;
  } catch (error) {
    toast(messageOf(error));
  }
}

const mentionCandidates = computed(() => {
  if (mentionQuery.value === null) return [];
  const q = mentionQuery.value.toLowerCase();
  return members.value
    .filter(
      (member) =>
        !q ||
        member.name.toLowerCase().includes(q) ||
        member.account.toLowerCase().includes(q),
    )
    .slice(0, 8);
});

function onCommentInput(): void {
  const text = commentDraft.value;
  const match = /(^|[\s])@([^\s@]*)$/.exec(text);
  if (!match) {
    mentionQuery.value = null;
    return;
  }
  mentionQuery.value = match[2] ?? '';
  mentionIndex.value = 0;
}

function insertMention(member: MemberDto): void {
  const text = commentDraft.value;
  const match = /(^|[\s])@([^\s@]*)$/.exec(text);
  if (!match) {
    commentDraft.value = `${text}${text && !/\s$/.test(text) ? ' ' : ''}@${member.name} `;
  } else {
    const start = text.length - (match[2]?.length ?? 0) - 1;
    commentDraft.value = `${text.slice(0, start)}@${member.name} ${text.slice(text.length)}`;
  }
  if (!commentMentions.value.includes(member.userId)) {
    commentMentions.value = [...commentMentions.value, member.userId];
  }
  mentionQuery.value = null;
}

function onCommentKeydown(event: KeyboardEvent): void {
  if (mentionQuery.value === null || mentionCandidates.value.length === 0) {
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    mentionIndex.value =
      (mentionIndex.value + 1) % mentionCandidates.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    mentionIndex.value =
      (mentionIndex.value - 1 + mentionCandidates.value.length) %
      mentionCandidates.value.length;
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    insertMention(mentionCandidates.value[mentionIndex.value]);
  } else if (event.key === 'Escape') {
    mentionQuery.value = null;
  }
}

function resolveMentionIds(body: string): string[] {
  const ids = new Set(commentMentions.value);
  for (const member of members.value) {
    if (
      body.includes(`@${member.name}`) ||
      body.includes(`@${member.account}`)
    ) {
      ids.add(member.userId);
    }
  }
  return [...ids];
}

function formatCommentBody(body: string): string {
  let html = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const sorted = [...members.value].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const member of sorted) {
    const token = `@${member.name}`;
    html = html.split(token).join(`<span class="mention">${token}</span>`);
  }
  return html.replace(/\n/g, '<br />');
}

async function postComment(): Promise<void> {
  if (!activeSheet.value || !commentDraft.value.trim() || commentSending.value) {
    return;
  }
  commentSending.value = true;
  try {
    const body = commentDraft.value.trim();
    const mentionedUserIds = resolveMentionIds(body);
    const comment = await endpoints.createComment(
      activeSheet.value.id,
      body,
      mentionedUserIds,
    );
    comments.value = [...comments.value, comment];
    commentDraft.value = '';
    commentMentions.value = [];
    mentionQuery.value = null;
  } catch (error) {
    toast(messageOf(error));
  } finally {
    commentSending.value = false;
  }
}

const importInput = ref<HTMLInputElement | null>(null);

function handleCreateAction(
  action: (typeof createMenuItems)[number]['action'],
): void {
  if (!canEditByRole.value) {
    toast('当前为只读权限，无法执行该操作');
    return;
  }
  if (action === 'import') {
    if (!canEditSheet.value) {
      toast('当前为只读权限，无法导入');
      return;
    }
    if (!activeSheet.value) {
      toast('请先选择一张工作表');
      return;
    }
    importInput.value?.click();
    return;
  }
  if (action === 'template') {
    templatesOpen.value = true;
  }
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !activeSheet.value) return;
  if (!canEditSheet.value) {
    toast('当前为只读权限，无法导入');
    return;
  }
  try {
    const result = await endpoints.importSheet(activeSheet.value.id, file);
    toast(
      result.errors.length > 0
        ? `已导入 ${result.imported} 条，${result.errors.length} 行有误`
        : `已导入 ${result.imported} 条记录`,
    );
    await selectSheet(activeSheet.value.id, false);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function applyViewQuery(query: ViewQuery): Promise<void> {
  if (!activeSheet.value) return;
  loading.value = true;
  try {
    const result = await endpoints.querySheet(activeSheet.value.id, query);
    records.value = result.records;
    nextCursor.value = null;
    totalRecordCount.value = null;
    recordOffset.value = 0;
    rowColors.value = result.colors;
    viewGroups.value = result.groups;
    rowHeightPx.value =
      typeof result.rowHeight === 'number'
        ? result.rowHeight
        : result.rowHeight === 'short'
          ? 28
          : result.rowHeight === 'tall'
            ? 48
            : 36;
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function exportActiveSheet(): Promise<void> {
  if (!activeSheet.value) {
    toast('请先选择一张工作表');
    return;
  }
  try {
    await endpoints.exportSheet(
      activeSheet.value.id,
      `${activeSheet.value.name}.xlsx`,
    );
  } catch (error) {
    toast(messageOf(error));
  }
}

function roleLabel(role: string): string {
  return (
    {
      owner: '所有者',
      admin: '管理员',
      editor: '可编辑',
      viewer: '只读',
    }[role] ?? role
  );
}

function openCreatedBase(result: { baseId: string }): void {
  templatesOpen.value = false;
  void router.push(`/workspaces/${workspaceId.value}/bases/${result.baseId}`);
}

async function onObjectTemplateCreated(
  result: TemplateInstantiateResult,
): Promise<void> {
  templatesOpen.value = false;
  try {
    if (result.kind === 'sheet' || result.kind === 'form') {
      const [sheetList, formList] = await Promise.all([
        endpoints.listSheets(baseId.value),
        endpoints.listForms(baseId.value).catch(() => [] as FormDto[]),
      ]);
      sheets.value = sheetList;
      forms.value = formList;
      if (result.kind === 'form' && result.sheetId) {
        markFormSheet(result.sheetId);
      }
      if (result.sheetId) {
        await selectSheet(result.sheetId);
      }
      return;
    }
    if (result.kind === 'dashboard' && result.dashboardId) {
      dashboards.value = await endpoints
        .listDashboards(baseId.value, 'dashboard')
        .catch(() => dashboards.value);
      openDashboard(result.dashboardId);
      return;
    }
    if (result.kind === 'report' && result.reportId) {
      analysisReports.value = await endpoints
        .listAnalysisReports(baseId.value)
        .catch(() => analysisReports.value);
      openAnalysisReport(result.reportId);
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return;
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    // Allow undo inside cell editor via CanvasGrid; skip when typing elsewhere.
    if (target.getAttribute('data-testid') !== 'cell-editor') return;
  }
  if (event.key === 'z' || event.key === 'Z') {
    event.preventDefault();
    if (event.shiftKey) void redoEdit();
    else void undoEdit();
    return;
  }
  if (event.key === 'y' || event.key === 'Y') {
    event.preventDefault();
    void redoEdit();
  }
}

let unsubAccept: (() => void) | null = null;
const liveUnsubs: Array<() => void> = [];

async function refreshSidebarLists(): Promise<void> {
  const id = baseId.value;
  if (!id) return;
  try {
    const [sheetList, formList, dashboardList, reportList] = await Promise.all([
      endpoints.listSheets(id),
      endpoints.listForms(id).catch(() => [] as FormDto[]),
      endpoints
        .listDashboards(id, 'dashboard')
        .catch(() => [] as DashboardDto[]),
      endpoints
        .listAnalysisReports(id)
        .catch(() => [] as AnalysisReportListItemDto[]),
    ]);
    sheets.value = sheetList;
    forms.value = formList;
    dashboards.value = dashboardList;
    analysisReports.value = reportList;

    if (
      activeSheet.value &&
      !sheetList.some((s) => s.id === activeSheet.value?.id)
    ) {
      const next =
        sheetList.find((s) => !isFormSheet(s))?.id ?? sheetList[0]?.id;
      if (next) await selectSheet(next);
      else {
        activeSheet.value = null;
        mainView.value = 'grid';
      }
    }
    if (
      activeDashboardId.value &&
      !dashboardList.some((d) => d.id === activeDashboardId.value)
    ) {
      activeDashboardId.value = '';
      if (mainView.value === 'dashboard') {
        const fallback =
          sheetList.find((s) => !isFormSheet(s))?.id ?? sheetList[0]?.id;
        if (fallback) await selectSheet(fallback);
      }
    }
    if (
      activeAnalysisReportId.value &&
      !reportList.some((r) => r.id === activeAnalysisReportId.value)
    ) {
      activeAnalysisReportId.value = '';
      if (mainView.value === 'analysis') {
        const fallback =
          sheetList.find((s) => !isFormSheet(s))?.id ?? sheetList[0]?.id;
        if (fallback) await selectSheet(fallback);
      }
    }
  } catch {
    /* live 刷新失败不打断编辑 */
  }
}

function onLiveSidebar(event: LiveEvent): void {
  void refreshSidebarLists();
  if (
    event.kind === 'sheet.schema_changed' &&
    event.entityId &&
    activeSheet.value?.id === event.entityId
  ) {
    void selectSheet(activeSheet.value.id, false);
  }
  if (
    event.kind === 'sheet.rev_bumped' &&
    event.entityId &&
    activeSheet.value?.id === event.entityId
  ) {
    void reloadActiveRecords();
  }
  if (
    event.kind === 'view.changed' &&
    event.entityId &&
    activeSheet.value?.id === event.entityId
  ) {
    void endpoints
      .listSavedViews(event.entityId)
      .then((list) => {
        savedViews.value = list;
      })
      .catch(() => undefined);
  }
  if (event.kind === 'member.changed') {
    const meta = event.meta ?? {};
    const action = meta.action;
    if (
      event.entityId &&
      (action === 'avatar' || action === 'username')
    ) {
      collabSocket.patchPeerProfile(event.entityId, {
        account: typeof meta.account === 'string' ? meta.account : undefined,
        name: typeof meta.name === 'string' ? meta.name : undefined,
        avatarSeed:
          typeof meta.avatarSeed === 'string' ? meta.avatarSeed : undefined,
        avatarUrl:
          meta.avatarUrl === null || typeof meta.avatarUrl === 'string'
            ? meta.avatarUrl
            : undefined,
      });
      if (event.entityId === auth.state.user?.id) {
        auth.updateUser({
          id: auth.state.user.id,
          account:
            typeof meta.account === 'string'
              ? meta.account
              : auth.state.user.account,
          name:
            typeof meta.name === 'string' ? meta.name : auth.state.user.name,
          avatarSeed:
            typeof meta.avatarSeed === 'string'
              ? meta.avatarSeed
              : auth.state.user.avatarSeed,
          avatarUrl:
            meta.avatarUrl === null || typeof meta.avatarUrl === 'string'
              ? meta.avatarUrl
              : (auth.state.user.avatarUrl ?? null),
        });
      }
    }
    void endpoints
      .listMembers(workspaceId.value)
      .then((list) => {
        members.value = list;
      })
      .catch(() => undefined);
  }
  if (event.kind === 'permission.changed') {
    void (async () => {
      await refreshSidebarLists();
      if (activeSheet.value) {
        await refreshSheetAcl(activeSheet.value.id);
        await refreshFormAcl(activeSheet.value.id);
      }
      if (mainView.value === 'dashboard' && activeDashboardId.value) {
        await refreshDashboardAcl(activeDashboardId.value);
      }
    })();
  }
}

function onCommentLive(event: LiveEvent): void {
  if (!commentsOpen.value || !activeSheet.value) return;
  if (event.meta?.sheetId !== activeSheet.value.id) return;
  void endpoints
    .listComments(activeSheet.value.id)
    .then((list) => {
      comments.value = list;
    })
    .catch(() => undefined);
}

function bindLiveBus(): void {
  liveUnsubs.push(
    liveBus.on('sheet.*', onLiveSidebar),
    liveBus.on('form.*', onLiveSidebar),
    liveBus.on('dashboard.*', onLiveSidebar),
    liveBus.on('widget.changed', onLiveSidebar),
    liveBus.on('schedule.updated', onLiveSidebar),
    liveBus.on('analysis.*', onLiveSidebar),
    liveBus.on('base.updated', onLiveSidebar),
    liveBus.on('member.changed', onLiveSidebar),
    liveBus.on('permission.changed', onLiveSidebar),
    liveBus.on('automation.*', onLiveSidebar),
    liveBus.on('view.changed', onLiveSidebar),
    liveBus.on('template.changed', onLiveSidebar),
    liveBus.on('comment.changed', onCommentLive),
  );
}

watch(
  [baseId, workspaceId],
  ([bid, wid]) => {
    if (bid) {
      liveSocket.connect({
        baseId: bid,
        workspaceId: wid || undefined,
      });
    } else {
      liveSocket.disconnect();
    }
  },
  { immediate: true },
);

onMounted(() => {
  void bootstrap();
  void messageCenter.bootstrap();
  unsubAccept = messageCenter.onAccept(onCommitAccept);
  bindLiveBus();
  collabSocket.setHandlers({
    onRemote: ({ mutations, commitId }) => {
      if (!messageCenter.shouldApplyRemote(commitId)) return;
      applyRemoteMutations(mutations);
    },
  });
  window.addEventListener('keydown', onGlobalKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  unsubAccept?.();
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  liveSocket.disconnect();
  messageCenter.attachSheet(null);
});
</script>

<template>
  <div class="shell">
    <input
      ref="importInput"
      type="file"
      accept=".xlsx"
      class="hidden-file"
      data-testid="excel-import-input"
      @change="onImportFile"
    />
    <header class="topbar">
      <div class="topbar-left">
        <span class="brand-mark small">▦</span>
        <nav class="breadcrumb">
          <button
            class="crumb-link"
            @click="router.push({ path: '/', query: { ws: workspaceId } })"
          >
            {{ workspace?.name ?? '工作区' }}
          </button>
          <span class="crumb-sep">/</span>
          <span class="crumb-current">{{ base?.name ?? 'Base' }}</span>
        </nav>
        <span
          v-if="showReadonlyBanner"
          class="sync-banner sync-banner-readonly"
          data-testid="readonly-banner"
        >
          只读
        </span>
        <span
          v-if="syncBannerText"
          class="sync-banner"
          data-testid="sync-banner"
          :data-status="messageCenter.status.value"
        >
          {{ syncBannerText }}
          <button
            v-if="messageCenter.status.value === 'conflict'"
            type="button"
            class="sync-banner-btn"
            @click="messageCenter.retryConflicts(); reloadActiveRecords()"
          >
            重试
          </button>
        </span>
      </div>
      <div class="topbar-right">
        <div
          v-if="collabPeers.length"
          class="collab-presence"
          data-testid="collab-presence"
          :title="collabPeers.map((p) => p.name || p.account).join('、')"
        >
          <span
            v-for="peer in collabPeers.slice(0, 5)"
            :key="peer.userId"
            class="collab-avatar"
            :title="peer.name || peer.account"
          >
            <img
              class="collab-avatar-img"
              :src="
                resolveAvatarSrc({
                  avatarUrl: peer.avatarUrl,
                  avatarSeed: peer.avatarSeed,
                  account: peer.account,
                  size: 48,
                })
              "
              :alt="peer.name || peer.account"
            />
          </span>
          <span
            v-if="collabPeers.length > 5"
            class="collab-more"
          >+{{ collabPeers.length - 5 }}</span>
          <span class="collab-count">{{ collabPeers.length }} 人在线</span>
        </div>
        <NotificationBell />
        <button
          v-if="canEditByRole"
          class="topbar-btn"
          data-testid="automation-open"
          @click="automationsOpen = true"
        >
          自动化
        </button>
        <div class="more-wrap">
          <button
            class="topbar-btn"
            data-testid="more-open"
            @click="moreOpen = !moreOpen"
          >
            更多 ▾
          </button>
          <Transition name="menu-fade">
            <div v-if="moreOpen" class="more-menu" data-testid="more-menu">
              <button
                data-testid="comments-toggle"
                @click="openComments(); moreOpen = false"
              >
                评论
              </button>
              <button
                data-testid="permissions-open"
                @click="permissionsOpen = true; moreOpen = false"
              >
                内容权限
              </button>
              <button
                v-if="canEditByRole"
                data-testid="public-view-open"
                :disabled="!activeSheet"
                @click="publicViewOpen = true; moreOpen = false"
              >
                公开视图
              </button>
              <button
                data-testid="excel-export"
                @click="exportActiveSheet(); moreOpen = false"
              >
                导出 Excel
              </button>
              <template v-if="canEditByRole">
                <div class="more-sep"></div>
                <button @click="renameActiveSheet">重命名当前工作表</button>
                <button
                  data-testid="more-public-view"
                  :disabled="!activeSheet"
                  @click="publicViewOpen = true; moreOpen = false"
                >
                  公开只读视图
                </button>
                <div class="more-sep"></div>
                <button
                  class="danger"
                  data-testid="more-delete-sheet"
                  :disabled="!activeSheet"
                  @click="deleteActiveSheet"
                >
                  删除当前工作表
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <div class="base-body">
      <aside class="sidebar">
        <div class="sidebar-scroll">
          <div class="sidebar-section">
            <div class="sidebar-title">
              <button
                type="button"
                class="section-toggle"
                @click="toggleSection('sheets')"
              >
                <span class="section-caret">{{
                  sectionCollapsed.sheets ? '▸' : '▾'
                }}</span>
                <span>工作表</span>
                <span v-if="dataSheets.length" class="section-count">{{
                  dataSheets.length
                }}</span>
              </button>
              <button
                v-if="canEditByRole"
                class="icon-btn"
                title="新建工作表"
                data-testid="create-sheet"
                @click="createSheet"
              >
                +
              </button>
            </div>
            <template v-if="!sectionCollapsed.sheets">
              <div
                v-for="sheet in dataSheets"
                :key="sheet.id"
                class="sheet-row"
                :class="{
                  active:
                    mainView !== 'dashboard' && sheet.id === activeSheet?.id,
                }"
              >
                <button class="sidebar-item" @click="selectSheet(sheet.id)">
                  <span class="sheet-icon">▦</span>
                  <span class="sheet-label">{{ sheet.name }}</span>
                </button>
                <button
                  v-if="canEditByRole"
                  class="sheet-more"
                  title="工作表操作"
                  :data-testid="`sheet-menu-${sheet.name}`"
                  @click.stop="
                    sheetMenuId = sheetMenuId === sheet.id ? null : sheet.id
                  "
                >
                  ⋯
                </button>
                <Transition name="menu-fade">
                  <div v-if="canEditByRole && sheetMenuId === sheet.id" class="sheet-menu">
                    <button @click.stop="renameSheet(sheet)">重命名</button>
                    <button class="danger" @click.stop="deleteSheet(sheet)">
                      删除工作表
                    </button>
                  </div>
                </Transition>
              </div>
              <p v-if="!dataSheets.length" class="sidebar-hint">暂无工作表</p>
            </template>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-title">
              <button
                type="button"
                class="section-toggle"
                @click="toggleSection('forms')"
              >
                <span class="section-caret">{{
                  sectionCollapsed.forms ? '▸' : '▾'
                }}</span>
                <span>收集表单</span>
                <span v-if="formSheets.length" class="section-count">{{
                  formSheets.length
                }}</span>
              </button>
              <button
                v-if="canEditByRole"
                class="icon-btn"
                title="新建收集表单"
                data-testid="forms-open"
                @click="openOrCreateFormSheet"
              >
                +
              </button>
            </div>
            <template v-if="!sectionCollapsed.forms">
              <div
                v-for="sheet in formSheets"
                :key="sheet.id"
                class="sheet-row"
                :class="{
                  active:
                    mainView !== 'dashboard' && sheet.id === activeSheet?.id,
                }"
              >
                <button class="sidebar-item" @click="selectSheet(sheet.id)">
                  <span class="sheet-icon">📝</span>
                  <span class="sheet-label">{{ sheet.name }}</span>
                </button>
                <button
                  v-if="canEditByRole"
                  class="sheet-more"
                  title="表单操作"
                  :data-testid="`sheet-menu-${sheet.name}`"
                  @click.stop="
                    sheetMenuId = sheetMenuId === sheet.id ? null : sheet.id
                  "
                >
                  ⋯
                </button>
                <Transition name="menu-fade">
                  <div v-if="canEditByRole && sheetMenuId === sheet.id" class="sheet-menu">
                    <button @click.stop="renameSheet(sheet)">重命名</button>
                    <button class="danger" @click.stop="deleteSheet(sheet)">
                      删除表单
                    </button>
                  </div>
                </Transition>
              </div>
              <p v-if="!formSheets.length" class="sidebar-hint">暂无收集表单</p>
            </template>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-title">
              <button
                type="button"
                class="section-toggle"
                @click="toggleSection('dashboards')"
              >
                <span class="section-caret">{{
                  sectionCollapsed.dashboards ? '▸' : '▾'
                }}</span>
                <span>仪表盘</span>
                <span v-if="dashboards.length" class="section-count">{{
                  dashboards.length
                }}</span>
              </button>
              <button
                v-if="canEditByRole"
                class="icon-btn"
                title="新建仪表盘"
                data-testid="dashboard-open"
                @click="createDashboard"
              >
                +
              </button>
            </div>
            <template v-if="!sectionCollapsed.dashboards">
              <div
                v-for="dashboard in dashboards"
                :key="dashboard.id"
                class="sheet-row"
                :class="{
                  active:
                    mainView === 'dashboard' &&
                    activeDashboardId === dashboard.id,
                }"
              >
                <button
                  class="sidebar-item"
                  type="button"
                  data-testid="dashboard-row"
                  @click="openDashboard(dashboard.id)"
                >
                  <span class="sheet-icon">📊</span>
                  <span class="sheet-label">{{ dashboard.name }}</span>
                </button>
                <button
                  v-if="canEditByRole"
                  class="sheet-more"
                  title="仪表盘操作"
                  :data-testid="`dashboard-menu-${dashboard.name}`"
                  @click.stop="
                    sheetMenuId =
                      sheetMenuId === dashboard.id ? null : dashboard.id
                  "
                >
                  ⋯
                </button>
                <Transition name="menu-fade">
                  <div
                    v-if="canEditByRole && sheetMenuId === dashboard.id"
                    class="sheet-menu"
                  >
                    <button @click.stop="renameDashboard(dashboard)">
                      重命名
                    </button>
                    <button
                      class="danger"
                      @click.stop="deleteDashboard(dashboard)"
                    >
                      删除仪表盘
                    </button>
                  </div>
                </Transition>
              </div>
              <p v-if="!dashboards.length" class="sidebar-hint">暂无仪表盘</p>
            </template>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-title">
              <button
                type="button"
                class="section-toggle"
                @click="toggleSection('reports')"
              >
                <span class="section-caret">{{
                  sectionCollapsed.reports ? '▸' : '▾'
                }}</span>
                <span>分析报告</span>
                <span v-if="analysisReports.length" class="section-count">{{
                  analysisReports.length
                }}</span>
              </button>
              <button
                v-if="canEditByRole"
                class="icon-btn"
                title="新建分析报告"
                data-testid="report-open"
                @click="createAnalysisReport"
              >
                +
              </button>
            </div>
            <template v-if="!sectionCollapsed.reports">
              <div
                v-for="report in analysisReports"
                :key="report.id"
                class="sheet-row"
                :class="{
                  active:
                    mainView === 'analysis' &&
                    activeAnalysisReportId === report.id,
                }"
              >
                <button
                  class="sidebar-item"
                  type="button"
                  data-testid="analysis-report-row"
                  @click="openAnalysisReport(report.id)"
                >
                  <span class="sheet-icon">📈</span>
                  <span class="sheet-label">{{ report.name }}</span>
                </button>
                <button
                  v-if="canEditByRole"
                  class="sheet-more"
                  title="分析报告操作"
                  :data-testid="`report-menu-${report.name}`"
                  @click.stop="
                    sheetMenuId = sheetMenuId === report.id ? null : report.id
                  "
                >
                  ⋯
                </button>
                <Transition name="menu-fade">
                  <div v-if="canEditByRole && sheetMenuId === report.id" class="sheet-menu">
                    <button @click.stop="renameAnalysisReport(report)">
                      重命名
                    </button>
                    <button
                      class="danger"
                      @click.stop="deleteAnalysisReport(report)"
                    >
                      删除报告
                    </button>
                  </div>
                </Transition>
              </div>
              <p v-if="!analysisReports.length" class="sidebar-hint">
                暂无分析报告
              </p>
            </template>
          </div>
        </div>

        <div v-if="canEditByRole" class="sidebar-create" data-testid="create-menu">
          <button
            v-for="item in createMenuItems"
            :key="item.action"
            type="button"
            class="create-menu-item"
            :data-testid="
              item.action === 'template' ? 'template-open' : undefined
            "
            @click="handleCreateAction(item.action)"
          >
            <span class="sheet-icon">{{ item.icon }}</span>{{ item.label }}
          </button>
        </div>
      </aside>

      <main class="base-main">
        <div v-if="bootError" class="empty-state">{{ bootError }}</div>
        <DashboardPanel
          v-else-if="mainView === 'dashboard' && activeDashboardId"
          :key="activeDashboardId"
          embedded
          :base-id="baseId"
          :dashboard-id="activeDashboardId"
          kind="dashboard"
          :sheets="sheets"
          :editable="canEditDashboard"
        />
        <AnalysisReportPanel
          v-else-if="mainView === 'analysis' && activeAnalysisReportId"
          :key="activeAnalysisReportId"
          embedded
          :base-id="baseId"
          :sheets="sheets"
          :report-id="activeAnalysisReportId"
          :editable="canEditByRole"
          @close="closeAnalysisReport"
          @created="onAnalysisReportCreated"
        />
        <template
          v-else-if="
            activeSheet &&
            (mainView === 'form' || mainView === 'form-results') &&
            isFormSheet(activeSheet)
          "
        >
          <!-- 收集表单 | 表单收集结果 —— 与「编辑/填写」分层 -->
          <div class="form-object-tabs" data-testid="form-object-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="mainView === 'form'"
              :class="{ active: mainView === 'form' }"
              data-testid="form-object-form"
              @click="backToForm(formReturnTab)"
            >
              收集表单
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="mainView === 'form-results'"
              :class="{ active: mainView === 'form-results' }"
              data-testid="form-object-results"
              @click="openFormResults"
            >
              收集结果
              <span v-if="records.length" class="form-object-count">{{ records.length }}</span>
            </button>
          </div>
          <FormBuilderPanel
            v-if="mainView === 'form'"
            :key="`form-${activeSheet.id}`"
            embedded
            :base-id="baseId"
            :workspace-id="workspaceId"
            :sheet="activeSheet"
            :initial-tab="formReturnTab"
            :editable="canEditForm"
            @sheet-updated="onFormSheetUpdated"
            @form-saved="onFormSaved"
          />
          <div v-else class="form-results-pane">
            <div class="form-results-banner">
              <div>
                <strong>表单收集结果</strong>
                <p>来自公开填写页与填写预览的提交记录，可在此筛选、导出或继续编辑。</p>
              </div>
              <button class="btn" type="button" @click="backToForm(formReturnTab)">
                返回表单设计
              </button>
            </div>
            <GridPanel
              ref="gridRef"
              :key="`results-${activeSheet.id}`"
              :sheet-id="activeSheet.id"
              :sheet-name="activeSheet.name"
              :fields="activeSheet.fields ?? []"
              :records="records"
              :total-record-count="totalRecordCount"
              :record-offset="recordOffset"
              :record-lookup="lookupRecord"
              :record-cache-epoch="recordCacheEpoch"
              :next-cursor="nextCursor"
              :loading="loading"
              :editable="canEditSheet"
              :row-colors="rowColors"
              :row-height="rowHeightPx"
              :groups="viewGroups"
              :members="members"
              :sheets="sheets"
              :upload-attachment="uploadToSheet"
              :peer-cursors="peerCursors"
              :acquire-cell-lock="acquireCellLockForGrid"
              :release-cell-lock="releaseCellLockForGrid"
              :peer-cell-locks="peerCellLocks"
              @add-row="addRow"
              @insert-rows="insertRows"
              @insert-columns="insertColumns"
              @load-more="loadMore"
              @ensure-window="ensureRecordWindow"
              @refresh="refreshSheet"
              @undo="undoEdit"
              @redo="redoEdit"
              @commit="commitCell"
              @toggle-field="toggleField"
              @create-field="createField"
              @update-field="updateFieldMeta"
              @delete-field="deleteField"
              @delete-records="deleteRecords"
              @query="applyViewQuery"
              @query-change="onQueryChange"
              @peer-cursor="onPeerCursor"
            />
          </div>
        </template>
        <template v-else-if="activeSheet">
          <div class="view-tabs-bar" data-testid="view-tabs-bar">
            <div class="view-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                class="view-tab"
                :class="{ active: !currentViewId }"
                data-testid="view-tab-default"
                :aria-selected="!currentViewId"
                @click="applyDefaultView"
              >
                全部记录
              </button>
              <div
                v-for="view in savedViews"
                :key="view.id"
                class="view-tab-wrap"
                :class="{ active: currentViewId === view.id }"
              >
                <button
                  type="button"
                  role="tab"
                  class="view-tab"
                  :class="{ active: currentViewId === view.id }"
                  :data-testid="`saved-view-${view.name}`"
                  :aria-selected="currentViewId === view.id"
                  @click="applySavedView(view)"
                >
                  {{ view.name }}
                </button>
                <button
                  v-if="canEditByRole"
                  type="button"
                  class="view-tab-action"
                  title="重命名"
                  @click.stop="renameSavedView(view)"
                >
                  ✎
                </button>
                <button
                  v-if="canEditByRole"
                  type="button"
                  class="view-tab-action danger"
                  title="删除"
                  @click.stop="deleteSavedView(view)"
                >
                  ×
                </button>
              </div>
            </div>
            <div v-if="canEditByRole" class="view-save">
              <input
                v-model="savedViewName"
                placeholder="保存为视图…"
                data-testid="saved-view-name"
                @keydown.enter.prevent="saveCurrentView"
              />
              <button
                class="btn btn-primary btn-mini"
                data-testid="saved-view-save"
                :disabled="savingView"
                @click="saveCurrentView"
              >
                保存
              </button>
            </div>
          </div>
          <GridPanel
            ref="gridRef"
            :key="activeSheet.id"
            :sheet-id="activeSheet.id"
            :sheet-name="activeSheet.name"
            :fields="activeSheet.fields ?? []"
            :records="records"
            :total-record-count="totalRecordCount"
            :record-offset="recordOffset"
            :record-lookup="lookupRecord"
            :record-cache-epoch="recordCacheEpoch"
            :next-cursor="nextCursor"
            :loading="loading"
            :editable="canEditSheet"
            :row-colors="rowColors"
            :row-height="rowHeightPx"
            :groups="viewGroups"
            :members="members"
            :sheets="sheets"
            :upload-attachment="uploadToSheet"
            :peer-cursors="peerCursors"
            :acquire-cell-lock="acquireCellLockForGrid"
            :release-cell-lock="releaseCellLockForGrid"
            :peer-cell-locks="peerCellLocks"
            @add-row="addRow"
            @insert-rows="insertRows"
            @insert-columns="insertColumns"
            @load-more="loadMore"
            @ensure-window="ensureRecordWindow"
            @refresh="refreshSheet"
            @undo="undoEdit"
            @redo="redoEdit"
            @commit="commitCell"
            @toggle-field="toggleField"
            @create-field="createField"
            @update-field="updateFieldMeta"
            @delete-field="deleteField"
            @delete-records="deleteRecords"
            @query="applyViewQuery"
            @query-change="onQueryChange"
            @peer-cursor="onPeerCursor"
          />
        </template>
        <div v-else class="empty-state">
          <p class="empty-state-title">还没有工作表</p>
          <p class="empty-state-hint">点击左侧「+」或「新建」创建第一张表，开始录入数据。</p>
          <button
            v-if="canEditByRole"
            class="btn btn-primary"
            type="button"
            @click="createSheet"
          >新建工作表</button>
        </div>
      </main>
    </div>

    <div
      v-if="commentsOpen"
      class="drawer-mask"
      @click.self="commentsOpen = false"
    ></div>
    <aside v-if="commentsOpen" class="comments-drawer">
      <header class="drawer-header">
        <h3>评论</h3>
        <button class="icon-btn" @click="commentsOpen = false">×</button>
      </header>
      <ul class="comment-list">
        <li v-for="comment in comments" :key="comment.id">
          <div class="comment-author">{{ comment.author.name }}</div>
          <p class="comment-body" v-html="formatCommentBody(comment.body)"></p>
        </li>
        <li v-if="comments.length === 0" class="muted">还没有评论，在下方输入开始讨论。</li>
      </ul>
      <form class="comment-form" @submit.prevent="postComment">
        <div class="comment-compose">
          <textarea
            v-model="commentDraft"
            data-testid="comment-input"
            rows="3"
            placeholder="输入评论，键入 @ 提及同事"
            @input="onCommentInput"
            @keydown="onCommentKeydown"
          ></textarea>
          <ul
            v-if="mentionQuery !== null && mentionCandidates.length"
            class="mention-menu"
            data-testid="mention-menu"
          >
            <li
              v-for="(member, index) in mentionCandidates"
              :key="member.userId"
              :class="{ active: index === mentionIndex }"
              :data-testid="`mention-option-${member.userId}`"
              @mousedown.prevent="insertMention(member)"
            >
              <strong>{{ member.name }}</strong>
              <span>{{ member.account }}</span>
            </li>
          </ul>
          <p
            v-else-if="mentionQuery !== null && members.length === 0"
            class="mention-empty"
          >
            暂无成员可提及
          </p>
        </div>
        <button
          class="btn btn-primary"
          data-testid="comment-send"
          :disabled="commentSending || !commentDraft.trim()"
        >
          {{ commentSending ? '发送中…' : '发送' }}
        </button>
      </form>
    </aside>

    <div
      v-if="automationsOpen"
      class="modal-mask"
      @click.self="automationsOpen = false"
    >
      <div class="modal automation-modal">
        <AutomationPanel
          :base-id="baseId"
          :editable="canEditByRole"
          @close="automationsOpen = false"
        />
      </div>
    </div>

    <div
      v-if="formBuilderOpen"
      class="modal-mask"
      @click.self="formBuilderOpen = false"
    >
      <div class="modal form-builder-modal">
        <FormBuilderPanel
          v-if="activeSheet"
          :key="activeSheet.id"
          :base-id="baseId"
          :workspace-id="workspaceId"
          :sheet="activeSheet"
          :editable="canEditForm"
          @close="formBuilderOpen = false"
          @form-saved="onFormSaved"
        />
        <div v-else class="empty-state">请先选择一张工作表</div>
      </div>
    </div>
    <div
      v-if="permissionsOpen"
      class="modal-mask"
      @click.self="permissionsOpen = false"
    >
      <PermissionsPanel
        :base-id="baseId"
        :can-manage="canManageMembers"
        @close="permissionsOpen = false"
      />
    </div>
    <div
      v-if="publicViewOpen && activeSheet"
      class="modal-mask"
      @click.self="publicViewOpen = false"
    >
      <PublicViewPanel
        :sheet-id="activeSheet.id"
        :editable="canEditByRole"
        @close="publicViewOpen = false"
      />
    </div>

    <div
      v-if="templatesOpen"
      class="modal-mask"
      @click.self="templatesOpen = false"
    >
      <TemplatePanel
        mode="base"
        :workspace-id="workspaceId"
        :base-id="baseId"
        @close="templatesOpen = false"
        @created="onObjectTemplateCreated"
      />
    </div>
  </div>
</template>

<style scoped>
.hidden-file {
  display: none;
}
.automation-modal {
  width: min(880px, 94vw);
  max-height: 88vh;
  padding: 16px 18px 12px;
  overflow: auto;
  border-radius: 12px;
}
.form-builder-modal {
  width: min(1120px, 95vw);
  max-height: 90vh;
  overflow: auto;
}
.section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 4px 6px;
  border-radius: 6px;
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.section-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-secondary, #646a73);
}
.section-caret {
  width: 10px;
  font-size: 10px;
  color: #a5a9b2;
}
.section-count {
  margin-left: 2px;
  padding: 0 5px;
  border-radius: 999px;
  background: #eef0f3;
  color: #8a9099;
  font-size: 11px;
  font-weight: 500;
}
.view-tabs-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border, #e5e6eb);
  background: #fff;
}
.view-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.view-tab-wrap {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
}
.view-tab-wrap:hover,
.view-tab-wrap.active {
  background: #f2f3f5;
}
.view-tab-wrap.active {
  background: #e8f3ff;
}
.view-tab {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #646a73);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.view-tab:hover {
  color: var(--text, #1f2329);
}
.view-tab.active {
  color: #1d6fdc;
  font-weight: 600;
  background: #e8f3ff;
}
.view-tab-wrap .view-tab {
  background: transparent;
}
.view-tab-wrap .view-tab.active {
  background: transparent;
}
.view-tab-action {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #8f959e;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
}
.view-tab-wrap:hover .view-tab-action {
  opacity: 1;
}
.view-tab-action:hover {
  background: #e5e6eb;
  color: #1f2329;
}
.view-tab-action.danger:hover {
  color: #d4380d;
  background: #fff1f0;
}
.view-save {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.view-save input {
  width: 140px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  font-size: 12px;
}
.view-save input:focus {
  outline: none;
  border-color: #2d8cf0;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.12);
}
@keyframes shell-menu-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.create-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.create-menu-item:hover {
  background: var(--bg-hover);
}
.more-wrap {
  position: relative;
}
.more-menu {
  position: absolute;
  top: 34px;
  right: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  width: 190px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.18);
  animation: shell-menu-in 0.14s ease;
}
.more-menu button {
  height: 32px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.more-menu button:hover {
  background: var(--bg-hover);
}
.more-menu button.danger {
  color: #d4380d;
}
.more-menu button:disabled {
  color: #b8bcc4;
  cursor: not-allowed;
}
.more-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--border);
}
.sheet-row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 6px;
}
.sheet-row:hover {
  background: var(--bg-hover);
}
.sheet-row.active {
  background: #e8f3ff;
  box-shadow: inset 3px 0 0 #2d8cf0;
}
.sheet-row .sidebar-item {
  flex: 1;
  min-width: 0;
  background: transparent;
}
.sheet-row.active .sidebar-item {
  color: #1a6dcc;
  font-weight: 600;
}
.sheet-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-more {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #8f959e;
  cursor: pointer;
  opacity: 0;
}
.sheet-row:hover .sheet-more,
.sheet-row.active .sheet-more {
  opacity: 1;
}
.sheet-menu {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: 130px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
}
.sheet-menu button {
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.sheet-menu button:hover {
  background: var(--bg-hover);
}
.sheet-menu button.danger {
  color: #d4380d;
}
.btn-mini {
  height: 28px !important;
  padding: 0 9px !important;
  font-size: 12px;
}
.sidebar-hint {
  margin: 2px 10px 4px;
  color: #a5a9b2;
  font-size: 11px;
  line-height: 1.5;
}
.sidebar-create {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.form-object-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid var(--border, #e5e6eb);
}
.form-object-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #646a73);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.form-object-tabs button:hover {
  background: var(--bg-hover, #f2f3f5);
  color: var(--text, #1f2329);
}
.form-object-tabs button.active {
  background: #e8f3ff;
  color: var(--brand-strong, #1d6fdc);
  font-weight: 600;
}
.form-object-tabs button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.28);
}
.form-object-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: rgba(29, 111, 220, 0.12);
  color: #1d6fdc;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}
.form-results-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.form-results-banner {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: #f7faff;
  border-bottom: 1px solid #d6e4ff;
}
.form-results-banner strong {
  display: block;
  font-size: 13px;
  color: #1f2329;
}
.form-results-banner p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #646a73;
}
.form-results-pane :deep(.grid-panel) {
  flex: 1;
  min-height: 0;
}
</style>
