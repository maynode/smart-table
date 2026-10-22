<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GridPanel from '../components/GridPanel.vue';
import MembersPanel from '../components/MembersPanel.vue';
import AutomationPanel from '../components/AutomationPanel.vue';
import FormBuilderPanel from '../components/FormBuilderPanel.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import DashboardPanel from '../components/DashboardPanel.vue';
import FolderPanel from '../components/FolderPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import SharePanel from '../components/SharePanel.vue';
import PublicViewPanel from '../components/PublicViewPanel.vue';
import DeveloperPanel from '../components/DeveloperPanel.vue';
import QuotaPanel from '../components/QuotaPanel.vue';
import SyncPanel from '../components/SyncPanel.vue';
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
import { toast } from '../ui/toast';
import type { ViewQuery } from 'shared';
import type {
  BaseDto,
  CommentDto,
  FieldDto,
  MemberDto,
  RecordDto,
  SavedViewDto,
  SheetDto,
  WorkspaceDto,
} from '../api/types';

const route = useRoute();
const router = useRouter();
const workspaceId = computed(() => String(route.params.workspaceId));
const baseId = computed(() => String(route.params.baseId));

const workspace = ref<WorkspaceDto | null>(null);
const base = ref<BaseDto | null>(null);
const sheets = ref<SheetDto[]>([]);
const activeSheet = ref<SheetDto | null>(null);
const records = ref<RecordDto[]>([]);
const nextCursor = ref<string | null>(null);
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

const membersOpen = ref(false);
const members = ref<MemberDto[]>([]);

const automationsOpen = ref(false);
const formBuilderOpen = ref(false);
const permissionsOpen = ref(false);
const dashboardOpen = ref(false);
const dashboardKind = ref<'dashboard' | 'report'>('dashboard');
const foldersOpen = ref(false);
const templatesOpen = ref(false);
const shareOpen = ref(false);
const publicViewOpen = ref(false);
const developerOpen = ref(false);
const quotaOpen = ref(false);
const syncOpen = ref(false);

const createMenuOpen = ref(false);

const createMenuItems = [
  { icon: '▦', label: '工作表', action: 'sheet' as const },
  { icon: '📊', label: '仪表盘', action: 'dashboard' as const },
  { icon: '📝', label: '收集表单', action: 'form' as const },
  { icon: '📈', label: '分析报告', action: 'report' as const },
  { icon: '📁', label: '文件夹', action: 'folder' as const },
  { icon: '📥', label: '导入表格', action: 'import' as const },
  { icon: '🔄', label: '同步数据', action: 'sync' as const },
  { icon: '🧩', label: '从模板新建', action: 'template' as const },
];

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '网络错误，请稍后重试';
}

async function bootstrap(): Promise<void> {
  bootError.value = '';
  try {
    const [ws, baseDetail, sheetList, memberList] = await Promise.all([
      endpoints.getWorkspace(workspaceId.value),
      endpoints.getBase(baseId.value),
      endpoints.listSheets(baseId.value),
      endpoints.listMembers(workspaceId.value).catch(() => [] as MemberDto[]),
    ]);
    workspace.value = ws;
    base.value = baseDetail;
    sheets.value = sheetList;
    members.value = memberList;

    const requested =
      typeof route.query.sheet === 'string' ? route.query.sheet : null;
    const target = requested ?? sheetList[0]?.id;
    if (target) {
      await selectSheet(target, false);
    }
  } catch (error) {
    bootError.value = messageOf(error);
  }
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
    activeSheet.value = detail;
    savedViews.value = views;
    currentViewId.value = '';
    currentQuery.value = {};
    savedViewName.value = '';
    rowColors.value = {};
    viewGroups.value = [];
    const page = await endpoints.listRecords(sheetId, null, 100);
    records.value = page.records;
    nextCursor.value = page.nextCursor;
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

async function addRow(): Promise<void> {
  if (!activeSheet.value) return;
  try {
    const record = await endpoints.createRecord(activeSheet.value.id, {});
    records.value = [...records.value, record];
    toast('已添加一行');
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
  if (!activeSheet.value) return;
  try {
    const coerced =
      typeof payload.value === 'string'
        ? coerceCellValue(payload.field, payload.value)
        : payload.value;
    const previous =
      payload.previous !== undefined
        ? payload.previous
        : payload.record.cells[payload.field.id];
    const updated = await endpoints.updateRecord(
      payload.record.id,
      { [payload.field.id]: coerced },
      payload.record.version,
    );
    records.value = records.value.map((record) =>
      record.id === updated.id ? updated : record,
    );
    pushEdit({
      sheetId: activeSheet.value.id,
      recordId: updated.id,
      fieldId: payload.field.id,
      fieldName: payload.field.name,
      previous,
      next: coerced,
      label: `${payload.field.name}: ${formatHistoryValue(previous)} → ${formatHistoryValue(coerced)}`,
    });
  } catch (error) {
    toast(messageOf(error));
  }
}

async function applyHistoryValue(
  recordId: string,
  fieldId: string,
  value: unknown,
): Promise<boolean> {
  const record = records.value.find((item) => item.id === recordId);
  if (!record) {
    toast('记录已不存在，无法撤销/重做');
    return false;
  }
  try {
    const updated = await endpoints.updateRecord(
      recordId,
      { [fieldId]: value },
      record.version,
    );
    records.value = records.value.map((item) =>
      item.id === updated.id ? updated : item,
    );
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

async function loadMore(): Promise<void> {
  if (!activeSheet.value || !nextCursor.value || loading.value) return;
  loading.value = true;
  try {
    const page = await endpoints.listRecords(
      activeSheet.value.id,
      nextCursor.value,
      100,
    );
    records.value = [...records.value, ...page.records];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function toggleField(payload: {
  field: FieldDto;
  hidden: boolean;
}): Promise<void> {
  try {
    const updated = await endpoints.updateField(payload.field.id, {
      hidden: payload.hidden,
    });
    if (activeSheet.value) {
      activeSheet.value = {
        ...activeSheet.value,
        fields: (activeSheet.value.fields ?? []).map((field) =>
          field.id === updated.id ? updated : field,
        ),
      };
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

async function createField(payload: {
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): Promise<void> {
  if (!activeSheet.value) return;
  try {
    const created = await endpoints.createField(activeSheet.value.id, {
      name: payload.name,
      type: payload.type,
      options: payload.options,
    });
    activeSheet.value = {
      ...activeSheet.value,
      fields: [...(activeSheet.value.fields ?? []), created],
    };
    toast(`已添加字段「${created.name}」`);
    // Relation / formula / lookup need follow-up config (企微加列后进配置).
    if (
      created.type === 'relation' ||
      created.type === 'formula' ||
      created.type === 'lookup' ||
      created.type === 'ai'
    ) {
      gridRef.value?.openFieldOptions?.(created);
    }
  } catch (error) {
    toast(messageOf(error));
  }
}

async function updateFieldMeta(payload: {
  field: FieldDto;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): Promise<void> {
  try {
    const patch: {
      name?: string;
      type?: string;
      options?: Record<string, unknown>;
    } = {};
    if (payload.name !== payload.field.name) patch.name = payload.name;
    if (payload.type !== payload.field.type) patch.type = payload.type;
    if (payload.options !== undefined) patch.options = payload.options;
    if (Object.keys(patch).length === 0) return;

    const updated = await endpoints.updateField(payload.field.id, patch);
    if (activeSheet.value) {
      activeSheet.value = {
        ...activeSheet.value,
        fields: (activeSheet.value.fields ?? []).map((field) =>
          field.id === updated.id ? updated : field,
        ),
      };
    }
    toast(`已更新字段「${updated.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteField(field: FieldDto): Promise<void> {
  try {
    await endpoints.deleteField(field.id);
    if (activeSheet.value) {
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
    }
    toast(`已删除字段「${field.name}」`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function deleteRecords(recordIds: string[]): Promise<void> {
  if (!activeSheet.value || recordIds.length === 0) return;
  try {
    await Promise.all(recordIds.map((recordId) => endpoints.deleteRecord(recordId)));
    records.value = records.value.filter(
      (record) => !recordIds.includes(record.id),
    );
    toast(`已删除 ${recordIds.length} 条记录`);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function uploadToSheet(file: File) {
  if (!activeSheet.value) throw new Error('no active sheet');
  return endpoints.uploadAttachment(activeSheet.value.id, file);
}

async function renameSheet(sheet: SheetDto): Promise<void> {
  sheetMenuId.value = null;
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

async function createSheet(): Promise<void> {
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
        member.email.toLowerCase().includes(q),
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
    if (body.includes(`@${member.name}`) || body.includes(`@${member.email}`)) {
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

async function openMembers(): Promise<void> {
  membersOpen.value = true;
  try {
    members.value = await endpoints.listMembers(workspaceId.value);
  } catch (error) {
    toast(messageOf(error));
  }
}

const importInput = ref<HTMLInputElement | null>(null);

function handleCreateAction(
  action: (typeof createMenuItems)[number]['action'],
): void {
  createMenuOpen.value = false;
  if (action === 'sheet') {
    void createSheet();
    return;
  }
  if (action === 'form') {
    formBuilderOpen.value = true;
    return;
  }
  if (action === 'import') {
    if (!activeSheet.value) {
      toast('请先选择一张工作表');
      return;
    }
    importInput.value?.click();
    return;
  }
  if (action === 'dashboard' || action === 'report') {
    dashboardKind.value = action === 'report' ? 'report' : 'dashboard';
    dashboardOpen.value = true;
    return;
  }
  if (action === 'folder') {
    foldersOpen.value = true;
    return;
  }
  if (action === 'template') {
    templatesOpen.value = true;
    return;
  }
  if (action === 'sync') {
    if (!activeSheet.value) {
      toast('请先选择一张工作表');
      return;
    }
    syncOpen.value = true;
  }
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !activeSheet.value) return;
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

onMounted(() => {
  void bootstrap();
  window.addEventListener('keydown', onGlobalKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
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
          <button class="crumb-link" @click="router.push('/')">
            {{ workspace?.name ?? '工作区' }}
          </button>
          <span class="crumb-sep">/</span>
          <span class="crumb-current">{{ base?.name ?? 'Base' }}</span>
        </nav>
      </div>
      <div class="topbar-right">
        <NotificationBell />
        <button class="topbar-btn" @click="openMembers">成员</button>
        <button
          class="topbar-btn"
          data-testid="share-open"
          @click="shareOpen = true"
        >
          分享
        </button>
        <button
          class="topbar-btn"
          data-testid="comments-toggle"
          @click="openComments"
        >
          评论
        </button>
        <button
          class="topbar-btn"
          data-testid="permissions-open"
          @click="permissionsOpen = true"
        >
          内容权限
        </button>
        <button
          class="topbar-btn"
          data-testid="sync-open"
          :disabled="!activeSheet"
          @click="syncOpen = true"
        >
          同步数据
        </button>
        <button
          class="topbar-btn"
          data-testid="quota-open"
          @click="quotaOpen = true"
        >
          配额
        </button>
        <button
          class="topbar-btn"
          data-testid="developer-open"
          @click="developerOpen = true"
        >
          开发者
        </button>
        <button
          class="topbar-btn"
          data-testid="public-view-open"
          :disabled="!activeSheet"
          @click="publicViewOpen = true"
        >
          公开视图
        </button>
        <button
          class="topbar-btn"
          data-testid="automation-open"
          @click="automationsOpen = true"
        >
          自动化
        </button>
        <button
          class="topbar-btn"
          data-testid="excel-export"
          @click="exportActiveSheet"
        >
          导出
        </button>
        <div class="more-wrap">
          <button
            class="topbar-btn"
            data-testid="more-open"
            @click="moreOpen = !moreOpen"
          >
            更多 ▾
          </button>
          <div v-if="moreOpen" class="more-menu" data-testid="more-menu">
            <button @click="openMembers(); moreOpen = false">成员与邀请</button>
            <button @click="renameActiveSheet">重命名当前工作表</button>
            <button
              data-testid="more-public-view"
              :disabled="!activeSheet"
              @click="publicViewOpen = true; moreOpen = false"
            >
              公开只读视图
            </button>
            <button @click="quotaOpen = true; moreOpen = false">工作区配额</button>
            <button @click="developerOpen = true; moreOpen = false">开发者 / OpenAPI</button>
            <button @click="exportActiveSheet(); moreOpen = false">导出 Excel</button>
            <div class="more-sep"></div>
            <button
              class="danger"
              data-testid="more-delete-sheet"
              :disabled="!activeSheet"
              @click="deleteActiveSheet"
            >
              删除当前工作表
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="base-body">
      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">
            <span>工作表</span>
            <button
              class="icon-btn"
              title="新建工作表"
              data-testid="create-sheet"
              @click="createSheet"
            >
              +
            </button>
          </div>
          <div
            v-for="sheet in sheets"
            :key="sheet.id"
            class="sheet-row"
            :class="{ active: sheet.id === activeSheet?.id }"
          >
            <button class="sidebar-item" @click="selectSheet(sheet.id)">
              <span class="sheet-icon">▦</span>
              <span class="sheet-label">{{ sheet.name }}</span>
            </button>
            <button
              class="sheet-more"
              title="工作表操作"
              :data-testid="`sheet-menu-${sheet.name}`"
              @click.stop="sheetMenuId = sheetMenuId === sheet.id ? null : sheet.id"
            >
              ⋯
            </button>
            <div v-if="sheetMenuId === sheet.id" class="sheet-menu">
              <button @click.stop="renameSheet(sheet)">重命名</button>
              <button class="danger" @click.stop="deleteSheet(sheet)">删除工作表</button>
            </div>
          </div>
        </div>

        <div v-if="activeSheet" class="sidebar-section views-section">
          <div class="sidebar-title">
            <span>视图</span>
            <button
              v-if="savedViews.length"
              class="icon-btn"
              title="保存当前视图"
              data-testid="save-view-toggle"
              @click="saveCurrentView"
            >
              +
            </button>
          </div>
          <div class="saved-view-create">
            <input
              v-model="savedViewName"
              placeholder="输入视图名称"
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
          <div
            v-for="view in savedViews"
            :key="view.id"
            class="saved-view-row"
            :class="{ active: currentViewId === view.id }"
          >
            <button
              class="saved-view-apply"
              :data-testid="`saved-view-${view.name}`"
              @click="applySavedView(view)"
            >
              <span class="view-icon">▤</span>{{ view.name }}
            </button>
            <button class="icon-btn" title="重命名视图" @click="renameSavedView(view)">
              ✎
            </button>
            <button class="icon-btn danger" title="删除视图" @click="deleteSavedView(view)">
              ×
            </button>
          </div>
          <p v-if="savedViews.length === 0" class="sidebar-hint">
            设置筛选/排序后输入名称保存为命名视图。
          </p>
        </div>

        <div class="sidebar-section create-section">
          <button
            class="sidebar-create"
            data-testid="create-menu-toggle"
            @click="createMenuOpen = !createMenuOpen"
          >
            <span>+ 新建</span>
            <span class="create-caret">{{ createMenuOpen ? '▴' : '▾' }}</span>
          </button>
          <div v-if="createMenuOpen" class="create-menu" data-testid="create-menu">
            <button
              v-for="item in createMenuItems"
              :key="item.action"
              class="create-menu-item"
              :data-testid="
                item.action === 'form'
                  ? 'forms-open'
                  : item.action === 'dashboard'
                    ? 'dashboard-open'
                    : item.action === 'report'
                      ? 'report-open'
                      : item.action === 'folder'
                        ? 'folder-open'
                        : item.action === 'template'
                          ? 'template-open'
                          : item.action === 'sync'
                            ? 'sidebar-sync-open'
                            : undefined
              "
              @click="handleCreateAction(item.action)"
            >
              <span class="sheet-icon">{{ item.icon }}</span>{{ item.label }}
            </button>
          </div>
        </div>
      </aside>

      <main class="base-main">
        <div v-if="bootError" class="empty-state">{{ bootError }}</div>
        <GridPanel
          v-else-if="activeSheet"
          ref="gridRef"
          :key="activeSheet.id"
          :sheet-id="activeSheet.id"
          :sheet-name="activeSheet.name"
          :fields="activeSheet.fields ?? []"
          :records="records"
          :next-cursor="nextCursor"
          :loading="loading"
          :row-colors="rowColors"
          :row-height="rowHeightPx"
          :groups="viewGroups"
          :members="members"
          :sheets="sheets"
          :upload-attachment="uploadToSheet"
          @add-row="addRow"
          @load-more="loadMore"
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
        />
        <div v-else class="empty-state">还没有工作表，点击左侧 + 新建。</div>
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
        <li v-if="comments.length === 0" class="muted">还没有评论。</li>
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
              <span>{{ member.email }}</span>
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
      v-if="membersOpen"
      class="modal-mask"
      @click.self="membersOpen = false"
    >
      <MembersPanel
        :workspace-id="workspaceId"
        @close="membersOpen = false"
        @changed="members = $event"
      />
    </div>

    <div
      v-if="automationsOpen"
      class="modal-mask"
      @click.self="automationsOpen = false"
    >
      <div class="modal automation-modal">
        <AutomationPanel
          :base-id="baseId"
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
          :sheet="activeSheet"
          @close="formBuilderOpen = false"
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
        @close="permissionsOpen = false"
      />
    </div>
    <div
      v-if="dashboardOpen"
      class="modal-mask"
      @click.self="dashboardOpen = false"
    >
      <DashboardPanel
        :base-id="baseId"
        :kind="dashboardKind"
        :sheets="sheets"
        @close="dashboardOpen = false"
      />
    </div>
    <div
      v-if="foldersOpen"
      class="modal-mask"
      @click.self="foldersOpen = false"
    >
      <FolderPanel
        :workspace-id="workspaceId"
        :base-id="baseId"
        @close="foldersOpen = false"
      />
    </div>

    <div
      v-if="shareOpen"
      class="modal-mask"
      @click.self="shareOpen = false"
    >
      <SharePanel
        :workspace-id="workspaceId"
        :base-id="baseId"
        :sheet-id="activeSheet?.id"
        @close="shareOpen = false"
      />
    </div>

    <div
      v-if="syncOpen && activeSheet"
      class="modal-mask"
      @click.self="syncOpen = false"
    >
      <SyncPanel
        :sheet-id="activeSheet.id"
        :fields="activeSheet.fields ?? []"
        @close="syncOpen = false"
      />
    </div>

    <div v-if="quotaOpen" class="modal-mask" @click.self="quotaOpen = false">
      <QuotaPanel
        :workspace-id="workspace?.id ?? ''"
        @close="quotaOpen = false"
      />
    </div>

    <div
      v-if="developerOpen"
      class="modal-mask"
      @click.self="developerOpen = false"
    >
      <DeveloperPanel
        :workspace-id="workspace?.id ?? ''"
        @close="developerOpen = false"
      />
    </div>

    <div
      v-if="publicViewOpen && activeSheet"
      class="modal-mask"
      @click.self="publicViewOpen = false"
    >
      <PublicViewPanel
        :sheet-id="activeSheet.id"
        @close="publicViewOpen = false"
      />
    </div>

    <div
      v-if="templatesOpen"
      class="modal-mask"
      @click.self="templatesOpen = false"
    >
      <TemplatePanel
        :workspace-id="workspaceId"
        @close="templatesOpen = false"
        @created="openCreatedBase"
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
.create-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.sidebar-create {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.sidebar-create:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.create-caret {
  font-size: 10px;
  opacity: 0.7;
}
.create-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(31, 35, 41, 0.08);
}
.create-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
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
}
.sheet-row .sidebar-item {
  flex: 1;
  min-width: 0;
  background: transparent;
}
.sheet-row.active .sidebar-item {
  color: #1d6fdc;
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
.views-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.saved-view-create {
  display: flex;
  gap: 5px;
  padding: 2px 4px 6px;
}
.saved-view-create input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 7px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  font-size: 12px;
}
.btn-mini {
  height: 28px !important;
  padding: 0 9px !important;
  font-size: 12px;
}
.saved-view-row {
  display: flex;
  align-items: center;
  border-radius: 6px;
}
.saved-view-row:hover {
  background: var(--bg-hover);
}
.saved-view-row.active {
  background: #e8f3ff;
}
.saved-view-apply {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: none;
  background: transparent;
  text-align: left;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.saved-view-row.active .saved-view-apply {
  color: #1d6fdc;
  font-weight: 600;
}
.view-icon {
  color: #8f959e;
  font-size: 11px;
}
.sidebar-hint {
  margin: 2px 6px 4px;
  color: #a5a9b2;
  font-size: 11px;
  line-height: 1.5;
}
</style>
