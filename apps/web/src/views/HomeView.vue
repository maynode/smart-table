<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import MembersPanel from '../components/MembersPanel.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import { auth } from '../stores/auth';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import type {
  BaseDto,
  TemplateInstantiateResult,
  WorkspaceDto,
} from '../api/types';

const WS_STORAGE_KEY = 'smart-table.currentWorkspaceId';

const route = useRoute();
const router = useRouter();

const workspaces = ref<WorkspaceDto[]>([]);
const currentWorkspaceId = ref<string>('');
const bases = ref<BaseDto[]>([]);
const workspaceQuery = ref('');
const baseQuery = ref('');
const loading = ref(false);
const basesLoading = ref(false);
const membersOpen = ref(false);
const templateOpen = ref(false);
const permissionsOpen = ref(false);
const permissionsBaseId = ref('');
const moveOpen = ref(false);
const moveBaseId = ref('');
const moveTargetId = ref('');
const createMenuOpen = ref(false);
const rowMenuId = ref<string | null>(null);
const baseFormOpen = ref(false);
const baseFormMode = ref<'create' | 'edit'>('create');
const baseFormId = ref('');
const baseFormName = ref('');
const baseFormDescription = ref('');
const baseFormBusy = ref(false);

const currentWorkspace = computed(
  () =>
    workspaces.value.find((item) => item.id === currentWorkspaceId.value) ??
    null,
);

const filteredWorkspaces = computed(() => {
  const q = workspaceQuery.value.trim().toLowerCase();
  if (!q) return workspaces.value;
  return workspaces.value.filter((item) => item.name.toLowerCase().includes(q));
});

const filteredBases = computed(() => {
  const q = baseQuery.value.trim().toLowerCase();
  if (!q) return bases.value;
  return bases.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  );
});

const editableWorkspaces = computed(() =>
  workspaces.value.filter(
    (item) =>
      item.id !== currentWorkspaceId.value &&
      item.role &&
      item.role !== 'viewer',
  ),
);

const canEditCurrent = computed(() => {
  const role = currentWorkspace.value?.role;
  return role === 'owner' || role === 'admin' || role === 'editor';
});

const ownedBases = computed(() => bases.value.filter(isOwnedBase));

const roleLabel: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '可编辑',
  viewer: '只读',
};

function isOwnedBase(base: BaseDto): boolean {
  return base.workspaceId === currentWorkspaceId.value;
}

function ownedIndex(base: BaseDto): number {
  return ownedBases.value.findIndex((item) => item.id === base.id);
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

function formatTime(value: string): string {
  try {
    const date = new Date(value);
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (sameDay) {
      return `今天 ${date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function persistWorkspaceId(id: string): void {
  currentWorkspaceId.value = id;
  try {
    localStorage.setItem(WS_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  if (String(route.query.ws ?? '') !== id) {
    void router.replace({ path: '/', query: { ws: id } });
  }
}

function closeMenus(): void {
  createMenuOpen.value = false;
  rowMenuId.value = null;
}

function onDocumentClick(): void {
  closeMenus();
}

async function loadWorkspaces(): Promise<void> {
  loading.value = true;
  try {
    workspaces.value = await endpoints.listWorkspaces();
    const fromQuery = String(route.query.ws ?? '');
    const fromStorage = (() => {
      try {
        return localStorage.getItem(WS_STORAGE_KEY) ?? '';
      } catch {
        return '';
      }
    })();
    const preferred =
      workspaces.value.find((item) => item.id === fromQuery)?.id ??
      workspaces.value.find((item) => item.id === fromStorage)?.id ??
      workspaces.value[0]?.id ??
      '';
    if (preferred) {
      persistWorkspaceId(preferred);
      await loadBases();
    } else {
      currentWorkspaceId.value = '';
      bases.value = [];
    }
  } catch (error) {
    toast(messageOf(error) || '加载工作区失败');
  } finally {
    loading.value = false;
  }
}

async function loadBases(): Promise<void> {
  if (!currentWorkspaceId.value) return;
  basesLoading.value = true;
  try {
    bases.value = await endpoints.listBases(currentWorkspaceId.value);
  } catch (error) {
    toast(messageOf(error) || '加载智能表格失败');
  } finally {
    basesLoading.value = false;
  }
}

async function createWorkspace(): Promise<void> {
  const name = (await promptDialog('新建工作区', '未命名工作区', {
    confirmLabel: '创建',
  }))?.trim();
  if (!name) return;
  try {
    const workspace = await endpoints.createWorkspace(name);
    workspaces.value = [...workspaces.value, workspace];
    toast('工作区已创建');
    persistWorkspaceId(workspace.id);
    await loadBases();
  } catch (error) {
    toast(messageOf(error) || '创建工作区失败');
  }
}

async function selectWorkspace(id: string): Promise<void> {
  if (!id || id === currentWorkspaceId.value) return;
  closeMenus();
  persistWorkspaceId(id);
  baseQuery.value = '';
  await loadBases();
}

function openCreateBaseForm(): void {
  if (!currentWorkspaceId.value || !canEditCurrent.value) return;
  closeMenus();
  baseFormMode.value = 'create';
  baseFormId.value = '';
  baseFormName.value = '未命名表格';
  baseFormDescription.value = '';
  baseFormOpen.value = true;
}

function openEditBaseForm(base: BaseDto): void {
  closeMenus();
  if (!canEditCurrent.value || !isOwnedBase(base)) return;
  baseFormMode.value = 'edit';
  baseFormId.value = base.id;
  baseFormName.value = base.name;
  baseFormDescription.value = base.description ?? '';
  baseFormOpen.value = true;
}

async function submitBaseForm(): Promise<void> {
  const name = baseFormName.value.trim();
  if (!name) {
    toast('请填写名称');
    return;
  }
  const description = baseFormDescription.value.trim() || null;
  baseFormBusy.value = true;
  try {
    if (baseFormMode.value === 'create') {
      if (!currentWorkspaceId.value) return;
      const base = await endpoints.createBase(
        currentWorkspaceId.value,
        name,
        description,
      );
      baseFormOpen.value = false;
      toast('已创建');
      await loadBases();
      openBase(base.id);
      return;
    }
    await endpoints.updateBase(baseFormId.value, { name, description });
    baseFormOpen.value = false;
    toast('已保存');
    await loadBases();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    baseFormBusy.value = false;
  }
}

function openTemplate(): void {
  closeMenus();
  templateOpen.value = true;
}

async function deleteBase(base: BaseDto): Promise<void> {
  closeMenus();
  if (!canEditCurrent.value || !isOwnedBase(base)) return;
  const ok = await confirmDialog(`确定删除「${base.name}」？删除后无法恢复。`, {
    title: '删除智能表格',
    confirmLabel: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await endpoints.deleteBase(base.id);
    toast('已删除');
    await loadBases();
  } catch (error) {
    toast(messageOf(error));
  }
}

function openMove(base: BaseDto): void {
  closeMenus();
  if (!canEditCurrent.value || !isOwnedBase(base)) return;
  if (!editableWorkspaces.value.length) {
    toast('没有可移入的其他工作区（需要可编辑及以上权限）');
    return;
  }
  moveBaseId.value = base.id;
  moveTargetId.value = editableWorkspaces.value[0]?.id ?? '';
  moveOpen.value = true;
}

async function confirmMove(): Promise<void> {
  if (!moveBaseId.value || !moveTargetId.value) return;
  try {
    await endpoints.moveBase(moveBaseId.value, moveTargetId.value);
    toast('已移动');
    moveOpen.value = false;
    await loadBases();
  } catch (error) {
    toast(messageOf(error));
  }
}

async function moveOrder(base: BaseDto, direction: -1 | 1): Promise<void> {
  closeMenus();
  if (!currentWorkspaceId.value || !canEditCurrent.value) return;
  if (!isOwnedBase(base)) return;
  const owned = [...ownedBases.value];
  const index = owned.findIndex((item) => item.id === base.id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= owned.length) return;
  const swapped = [...owned];
  const tmp = swapped[index]!;
  swapped[index] = swapped[next]!;
  swapped[next] = tmp;
  try {
    bases.value = await endpoints.reorderBases(
      currentWorkspaceId.value,
      swapped.map((item) => item.id),
    );
  } catch (error) {
    toast(messageOf(error));
    await loadBases();
  }
}

function openPermissions(base: BaseDto): void {
  closeMenus();
  permissionsBaseId.value = base.id;
  permissionsOpen.value = true;
}

function openBase(baseId: string): void {
  closeMenus();
  if (!currentWorkspaceId.value) return;
  void router.push(
    `/workspaces/${currentWorkspaceId.value}/bases/${baseId}`,
  );
}

function toggleRowMenu(baseId: string, event: MouseEvent): void {
  event.stopPropagation();
  rowMenuId.value = rowMenuId.value === baseId ? null : baseId;
  createMenuOpen.value = false;
}

function onTemplateCreated(result: TemplateInstantiateResult): void {
  templateOpen.value = false;
  void loadBases().then(() => openBase(result.baseId));
}

function signOut(): void {
  auth.signOut();
  void router.push('/login');
}

watch(
  () => route.query.ws,
  (ws) => {
    const id = String(ws ?? '');
    if (id && id !== currentWorkspaceId.value) {
      void selectWorkspace(id);
    }
  },
);

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  void loadWorkspaces();
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<template>
  <div class="hub">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand-mark small">▦</span>
        <span class="product-name">智能表格</span>
        <span v-if="currentWorkspace" class="crumb">
          <span class="crumb-sep">/</span>
          <span class="crumb-ws">{{ currentWorkspace.name }}</span>
        </span>
      </div>

      <div class="topbar-search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          v-model="baseQuery"
          data-testid="hub-base-search"
          placeholder="搜索表格"
          :disabled="!currentWorkspaceId"
        />
      </div>

      <div class="topbar-actions">
        <div
          v-if="currentWorkspaceId && canEditCurrent"
          class="create-wrap"
          @click.stop
        >
          <button
            class="btn btn-primary create-btn"
            data-testid="create-base"
            @click="createMenuOpen = !createMenuOpen"
          >
            新建
            <span class="caret">{{ createMenuOpen ? '▴' : '▾' }}</span>
          </button>
          <Transition name="menu-fade">
            <div v-if="createMenuOpen" class="menu create-menu" data-testid="hub-create-menu">
              <button type="button" @click="openCreateBaseForm">空白表格</button>
              <button type="button" data-testid="hub-template" @click="openTemplate">
                从模板新建
              </button>
            </div>
          </Transition>
        </div>
        <button
          v-if="currentWorkspaceId"
          class="btn btn-ghost"
          data-testid="hub-members"
          @click="membersOpen = true"
        >
          成员
        </button>
        <div class="user-chip">
          <span class="avatar">{{ (auth.state.user?.name ?? '?').slice(0, 1) }}</span>
          <span class="user-name">{{ auth.state.user?.name }}</span>
          <button class="btn btn-ghost tiny" @click="signOut">退出</button>
        </div>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <div class="sidebar-title">
          <span>工作区</span>
          <button
            class="icon-btn plus"
            type="button"
            title="新建工作区"
            data-testid="create-workspace"
            @click="createWorkspace"
          >
            +
          </button>
        </div>
        <div class="sidebar-search">
          <input
            v-model="workspaceQuery"
            data-testid="hub-workspace-search"
            placeholder="筛选工作区"
          />
        </div>
        <p v-if="loading" class="hint">加载中…</p>
        <ul v-else class="ws-list">
          <li v-for="ws in filteredWorkspaces" :key="ws.id">
            <button
              type="button"
              class="ws-item"
              :class="{ active: ws.id === currentWorkspaceId }"
              :data-testid="`workspace-item-${ws.id}`"
              @click="selectWorkspace(ws.id)"
            >
              <span class="ws-dot" />
              <span class="ws-text">
                <span class="ws-name">{{ ws.name }}</span>
                <span class="ws-role">{{ roleLabel[ws.role ?? ''] ?? '成员' }}</span>
              </span>
            </button>
          </li>
          <li v-if="filteredWorkspaces.length === 0" class="hint">
            {{ workspaces.length ? '无匹配结果' : '点击右上角 + 创建工作区' }}
          </li>
        </ul>
      </aside>

      <main class="main">
        <div class="main-head">
          <div>
            <h1>{{ currentWorkspace?.name ?? '选择工作区' }}</h1>
            <p v-if="currentWorkspace" class="sub">
              {{ filteredBases.length }} 个智能表格
              <template v-if="baseQuery.trim()"> · 搜索「{{ baseQuery.trim() }}」</template>
            </p>
          </div>
        </div>

        <div v-if="!currentWorkspaceId" class="empty-panel">
          <div class="empty-icon">▦</div>
          <h2>还没有工作区</h2>
          <p>先创建一个工作区，再在里面新建智能表格。</p>
          <button class="btn btn-primary" @click="createWorkspace">创建工作区</button>
        </div>

        <p v-else-if="basesLoading" class="hint main-hint">加载表格…</p>

        <div
          v-else-if="filteredBases.length === 0"
          class="empty-panel"
          data-testid="base-list"
        >
          <div class="empty-icon">▦</div>
          <h2>{{ bases.length ? '没有匹配的表格' : '工作区还是空的' }}</h2>
          <p>
            {{
              bases.length
                ? '试试换个关键词，或清空搜索。'
                : '从空白表格开始，或用模板快速搭好表单与自动化。'
            }}
          </p>
          <div v-if="canEditCurrent && !bases.length" class="empty-actions">
            <button class="btn btn-primary" @click="openCreateBaseForm">新建空白表格</button>
            <button class="btn" @click="openTemplate">从模板新建</button>
          </div>
        </div>

        <div v-else class="base-list" data-testid="base-list">
          <article
            v-for="base in filteredBases"
            :key="base.id"
            class="base-item"
            data-testid="base-card"
            @click="openBase(base.id)"
          >
            <div class="base-tile" aria-hidden="true">▦</div>
            <div class="base-meta">
              <div class="base-title">{{ base.name }}</div>
              <p v-if="base.description" class="base-desc">{{ base.description }}</p>
              <div class="base-sub">
                更新于 {{ formatTime(base.updatedAt) }}
                <span v-if="!isOwnedBase(base)" class="badge">共享</span>
              </div>
            </div>
            <div class="base-more" @click.stop>
              <button
                type="button"
                class="more-btn"
                :aria-expanded="rowMenuId === base.id"
                :data-testid="`base-menu-${base.id}`"
                @click="toggleRowMenu(base.id, $event)"
              >
                ⋯
              </button>
              <div
                v-if="rowMenuId === base.id"
                class="menu row-menu"
                data-testid="base-row-menu"
              >
                <button type="button" @click="openBase(base.id)">打开</button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base)"
                  type="button"
                  @click="openEditBaseForm(base)"
                >
                  编辑
                </button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base) && !baseQuery.trim()"
                  type="button"
                  data-testid="base-move-up"
                  :disabled="ownedIndex(base) <= 0"
                  @click="moveOrder(base, -1)"
                >
                  上移
                </button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base) && !baseQuery.trim()"
                  type="button"
                  data-testid="base-move-down"
                  :disabled="ownedIndex(base) >= ownedBases.length - 1"
                  @click="moveOrder(base, 1)"
                >
                  下移
                </button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base)"
                  type="button"
                  data-testid="base-move"
                  @click="openMove(base)"
                >
                  移动到工作区…
                </button>
                <button
                  type="button"
                  data-testid="base-permissions"
                  @click="openPermissions(base)"
                >
                  内容权限
                </button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base)"
                  type="button"
                  class="danger"
                  data-testid="base-delete"
                  @click="deleteBase(base)"
                >
                  删除
                </button>
              </div>
            </div>
          </article>
        </div>
      </main>
    </div>

    <div
      v-if="membersOpen && currentWorkspaceId"
      class="modal-mask"
      @click.self="membersOpen = false"
    >
      <MembersPanel
        :workspace-id="currentWorkspaceId"
        @close="membersOpen = false"
      />
    </div>

    <div
      v-if="templateOpen && currentWorkspaceId"
      class="modal-mask"
      @click.self="templateOpen = false"
    >
      <TemplatePanel
        :workspace-id="currentWorkspaceId"
        @close="templateOpen = false"
        @created="onTemplateCreated"
      />
    </div>

    <div
      v-if="permissionsOpen && permissionsBaseId"
      class="modal-mask"
      @click.self="permissionsOpen = false"
    >
      <PermissionsPanel
        :base-id="permissionsBaseId"
        @close="permissionsOpen = false"
      />
    </div>

    <div v-if="moveOpen" class="modal-mask" @click.self="moveOpen = false">
      <section class="dialog" data-testid="move-dialog">
        <header class="dialog-head">
          <h3>移动到工作区</h3>
          <button class="icon-btn" type="button" @click="moveOpen = false">×</button>
        </header>
        <p class="dialog-desc">仅显示你拥有可编辑及以上权限的工作区。</p>
        <label class="field">
          <span>目标工作区</span>
          <select v-model="moveTargetId" data-testid="move-target">
            <option
              v-for="ws in editableWorkspaces"
              :key="ws.id"
              :value="ws.id"
            >
              {{ ws.name }}
            </option>
          </select>
        </label>
        <div class="dialog-actions">
          <button class="btn btn-ghost" type="button" @click="moveOpen = false">
            取消
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-testid="move-confirm"
            @click="confirmMove"
          >
            移动
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="baseFormOpen"
      class="modal-mask"
      @click.self="baseFormOpen = false"
    >
      <section class="dialog" data-testid="base-form-dialog">
        <header class="dialog-head">
          <h3>{{ baseFormMode === 'create' ? '新建智能表格' : '编辑智能表格' }}</h3>
          <button
            class="icon-btn"
            type="button"
            @click="baseFormOpen = false"
          >
            ×
          </button>
        </header>
        <label class="field">
          <span>名称</span>
          <input
            v-model="baseFormName"
            data-testid="base-form-name"
            maxlength="100"
            placeholder="表格名称"
            @keyup.enter="submitBaseForm"
          />
        </label>
        <label class="field">
          <span>描述<span class="optional">（选填）</span></span>
          <textarea
            v-model="baseFormDescription"
            data-testid="base-form-description"
            maxlength="500"
            rows="3"
            placeholder="简单说明这个表格做什么"
          />
        </label>
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            type="button"
            @click="baseFormOpen = false"
          >
            取消
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-testid="base-form-submit"
            :disabled="baseFormBusy"
            @click="submitBaseForm"
          >
            {{ baseFormMode === 'create' ? '创建' : '保存' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hub {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
}

.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: none;
}

.product-name {
  font-weight: 600;
  font-size: 15px;
}

.crumb {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.crumb-sep {
  margin: 0 6px;
  color: var(--text-tertiary);
}

.crumb-ws {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.topbar-search {
  flex: 1;
  max-width: 420px;
  position: relative;
}

.topbar-search input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #f2f3f5;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.topbar-search input:focus {
  outline: none;
  background: #fff;
  border-color: #91c0f8;
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.12);
}

.topbar-search input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  font-size: 14px;
  pointer-events: none;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.create-wrap {
  position: relative;
}

.create-btn .caret {
  margin-left: 2px;
  font-size: 10px;
  opacity: 0.85;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e8f3ff;
  color: var(--brand-strong);
  font-size: 13px;
  font-weight: 600;
}

.user-name {
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tiny {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.body {
  flex: 1;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 0;
}

.sidebar {
  background: #fff;
  border-right: 1px solid var(--border);
  padding: 14px 10px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

.plus {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
}

.plus:hover {
  background: var(--bg-hover);
  color: var(--brand);
}

.sidebar-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: #f2f3f5;
}

.sidebar-search input:focus {
  outline: none;
  background: #fff;
  border-color: var(--border-strong);
}

.ws-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}

.ws-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.ws-item:hover {
  background: #f5f6f8;
}

.ws-item.active {
  background: #e8f3ff;
}

.ws-dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: #c9cdd4;
  flex: none;
}

.ws-item.active .ws-dot {
  background: var(--brand);
}

.ws-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-name {
  font-size: 13px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-item.active .ws-name {
  color: var(--brand-strong);
}

.ws-role {
  font-size: 11px;
  color: var(--text-tertiary);
}

.main {
  padding: 28px 36px 40px;
  max-width: 1080px;
}

.main-head h1 {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.sub {
  margin: 6px 0 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.hint {
  margin: 0;
  padding: 12px 8px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.main-hint {
  padding: 24px 0;
}

.base-list {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.base-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.base-item:hover {
  border-color: #c7d7f5;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.06);
  transform: translateY(-1px);
}

.base-tile {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #e8f3ff, #f0f7ff);
  color: var(--brand);
  font-size: 18px;
  flex: none;
}

.base-meta {
  min-width: 0;
  flex: 1;
}

.base-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.base-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 999px;
  background: #f2f3f5;
  color: var(--text-secondary);
  font-size: 11px;
}

.base-more {
  position: relative;
  flex: none;
}

.more-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.more-btn:hover,
.base-item:hover .more-btn {
  background: var(--bg-hover);
}

.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 168px;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(31, 35, 41, 0.14);
  z-index: 30;
}

.menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}

.menu button:hover:not(:disabled) {
  background: #f5f6f8;
}

.menu button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu button.danger {
  color: var(--danger);
}

.create-menu {
  left: 0;
  right: auto;
}

.empty-panel {
  margin-top: 48px;
  max-width: 420px;
  text-align: left;
}

.empty-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e8f3ff;
  color: var(--brand);
  font-size: 24px;
  margin-bottom: 16px;
}

.empty-panel h2 {
  font-size: 18px;
  margin: 0 0 8px;
}

.empty-panel p {
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.empty-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.dialog {
  width: min(400px, 92vw);
  padding: 20px 20px 16px;
  border-radius: 14px;
  background: #fff;
  box-shadow: var(--shadow);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-head h3 {
  font-size: 16px;
}

.dialog-desc {
  margin: 8px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: #fff;
  resize: vertical;
}

.field input,
.field select {
  height: 36px;
  padding-top: 0;
  padding-bottom: 0;
}

.field textarea {
  min-height: 72px;
  line-height: 1.5;
}

.optional {
  color: var(--text-tertiary);
  font-weight: 400;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

@media (max-width: 860px) {
  .body {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 220px;
  }

  .main {
    padding: 20px 16px 32px;
  }

  .crumb,
  .user-name {
    display: none;
  }

  .topbar-search {
    max-width: none;
  }
}
</style>
