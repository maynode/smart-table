<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GridPanel from '../components/GridPanel.vue';
import AutomationPanel from '../components/AutomationPanel.vue';
import FormBuilderPanel from '../components/FormBuilderPanel.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import DashboardPanel from '../components/DashboardPanel.vue';
import FolderPanel from '../components/FolderPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toast } from '../ui/toast';
import type { ViewQuery } from 'shared';
import type {
  BaseDto,
  CommentDto,
  FieldDto,
  MemberDto,
  RecordDto,
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

const commentsOpen = ref(false);
const comments = ref<CommentDto[]>([]);
const commentDraft = ref('');
const commentSending = ref(false);

const membersOpen = ref(false);
const members = ref<MemberDto[]>([]);

const automationsOpen = ref(false);
const formBuilderOpen = ref(false);
const permissionsOpen = ref(false);
const dashboardOpen = ref(false);
const dashboardKind = ref<'dashboard' | 'report'>('dashboard');
const foldersOpen = ref(false);
const templatesOpen = ref(false);

const sidebarObjects = [
  { icon: '📝', label: '收集表单' },
  { icon: '📊', label: '仪表盘' },
  { icon: '📈', label: '分析报告' },
  { icon: '📁', label: '文件夹' },
  { icon: '📥', label: '导入' },
  { icon: '🔄', label: '同步' },
  { icon: '🧩', label: '模板' },
];

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '网络错误，请稍后重试';
}

async function bootstrap(): Promise<void> {
  bootError.value = '';
  try {
    const [ws, baseDetail, sheetList] = await Promise.all([
      endpoints.getWorkspace(workspaceId.value),
      endpoints.getBase(baseId.value),
      endpoints.listSheets(baseId.value),
    ]);
    workspace.value = ws;
    base.value = baseDetail;
    sheets.value = sheetList;

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
    const detail = await endpoints.getSheet(sheetId);
    activeSheet.value = detail;
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

async function commitCell(payload: {
  record: RecordDto;
  field: FieldDto;
  value: string;
}): Promise<void> {
  try {
    const updated = await endpoints.updateRecord(
      payload.record.id,
      { [payload.field.id]: payload.value },
      payload.record.version,
    );
    records.value = records.value.map((record) =>
      record.id === updated.id ? updated : record,
    );
  } catch (error) {
    toast(messageOf(error));
  }
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

async function createSheet(): Promise<void> {
  const name = window.prompt('新工作表名称', '新工作表');
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
    comments.value = await endpoints.listComments(activeSheet.value.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function postComment(): Promise<void> {
  if (!activeSheet.value || !commentDraft.value.trim() || commentSending.value) {
    return;
  }
  commentSending.value = true;
  try {
    const comment = await endpoints.createComment(
      activeSheet.value.id,
      commentDraft.value.trim(),
    );
    comments.value = [...comments.value, comment];
    commentDraft.value = '';
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

function comingSoon(label: string): void {
  toast(`${label}：该能力将在后续任务开放`);
}

const importInput = ref<HTMLInputElement | null>(null);

function handleObjectClick(label: string): void {
  if (label === '收集表单') {
    formBuilderOpen.value = true;
    return;
  }
  if (label === '导入') {
    if (!activeSheet.value) {
      toast('请先选择一张工作表');
      return;
    }
    importInput.value?.click();
    return;
  }
  if (label === '仪表盘' || label === '分析报告') {
    dashboardKind.value = label === '分析报告' ? 'report' : 'dashboard';
    dashboardOpen.value = true;
    return;
  }
  if (label === '文件夹') {
    foldersOpen.value = true;
    return;
  }
  if (label === '模板') {
    templatesOpen.value = true;
    return;
  }
  comingSoon(label);
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

onMounted(bootstrap);
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
        <button class="topbar-btn" @click="openMembers">成员</button>
        <button class="topbar-btn" @click="comingSoon('分享')">分享</button>
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
        <button class="topbar-btn" @click="comingSoon('更多')">更多</button>
      </div>
    </header>

    <div class="base-body">
      <aside class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">
            <span>工作表</span>
            <button class="icon-btn" title="新建工作表" @click="createSheet">
              +
            </button>
          </div>
          <button
            v-for="sheet in sheets"
            :key="sheet.id"
            class="sidebar-item"
            :class="{ active: sheet.id === activeSheet?.id }"
            @click="selectSheet(sheet.id)"
          >
            <span class="sheet-icon">▦</span>{{ sheet.name }}
          </button>
        </div>

        <div class="sidebar-section">
          <button
            v-for="item in sidebarObjects"
            :key="item.label"
            class="sidebar-item muted-item"
            :data-testid="
              item.label === '收集表单'
                ? 'forms-open'
                : item.label === '仪表盘'
                  ? 'dashboard-open'
                  : item.label === '分析报告'
                    ? 'report-open'
                    : item.label === '文件夹'
                      ? 'folder-open'
                      : item.label === '模板'
                        ? 'template-open'
                        : undefined
            "
            @click="handleObjectClick(item.label)"
          >
            <span class="sheet-icon">{{ item.icon }}</span>{{ item.label }}
          </button>
        </div>
      </aside>

      <main class="base-main">
        <div v-if="bootError" class="empty-state">{{ bootError }}</div>
        <GridPanel
          v-else-if="activeSheet"
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
          @add-row="addRow"
          @load-more="loadMore"
          @commit="commitCell"
          @toggle-field="toggleField"
          @query="applyViewQuery"
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
          <p>{{ comment.body }}</p>
        </li>
        <li v-if="comments.length === 0" class="muted">还没有评论。</li>
      </ul>
      <form class="comment-form" @submit.prevent="postComment">
        <textarea
          v-model="commentDraft"
          data-testid="comment-input"
          rows="3"
          placeholder="输入评论，@ 同事"
        ></textarea>
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
    >      <div class="modal">
        <header class="drawer-header">
          <h3>工作区成员</h3>
          <button class="icon-btn" @click="membersOpen = false">×</button>
        </header>
        <ul class="member-list">
          <li v-for="member in members" :key="member.userId">
            <span class="avatar">{{ member.name.slice(0, 1) }}</span>
            <span class="member-name">{{ member.name }}</span>
            <span class="member-email">{{ member.email }}</span>
            <span class="role-badge">{{ roleLabel(member.role) }}</span>
          </li>
        </ul>
        <p v-if="members.length === 0" class="muted">加载中…</p>
      </div>
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
  width: min(780px, 92vw);
  max-height: 82vh;
  overflow: auto;
}
.form-builder-modal {
  width: min(640px, 92vw);
  max-height: 86vh;
  overflow: auto;
}
</style>
