<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ACCOUNT_HINT,
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  PASSWORD_HINT,
  createAvatarSeed,
  validateAccount,
  validatePassword,
} from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import AvatarCropper from '../components/AvatarCropper.vue';
import MembersPanel from '../components/MembersPanel.vue';
import NotificationBell from '../components/NotificationBell.vue';
import PageLoading from '../components/PageLoading.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import { auth } from '../stores/auth';
import { liveBus } from '../sync/live-bus';
import { liveSocket } from '../sync/live-socket';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { buildAvatarUrl, resolveAvatarSrc } from '../utils/avatar';
import type {
  BaseDto,
  TemplateInstantiateResult,
  WorkspaceDto,
} from '../api/types';
import type { LiveEvent } from 'shared';

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
const templateOpen = ref(false);
const membersSectionOpen = ref(false);
const permissionsOpen = ref(false);
const permissionsBaseId = ref('');
const moveOpen = ref(false);
const moveBaseId = ref('');
const moveTargetId = ref('');
const userMenuOpen = ref(false);
const wsMenuId = ref<string | null>(null);
const wsMenuPos = ref<{ top: number; left: number } | null>(null);
const baseMenuId = ref<string | null>(null);
const baseMenuPos = ref<{ top: number; left: number } | null>(null);
type OnboardInviteRole = 'admin' | 'editor' | 'viewer';
type OnboardInviteRow = {
  key: number;
  account: string;
  role: OnboardInviteRole;
};

let onboardInviteKeySeq = 1;

const newWorkspaceName = ref('');
const onboardInvitePaste = ref('');
const onboardInviteDefaultRole = ref<OnboardInviteRole>('editor');
const onboardInviteRows = ref<OnboardInviteRow[]>([]);
const creatingWorkspace = ref(false);
const workspaceOnboardInput = ref<HTMLInputElement | null>(null);
const wsMenuTarget = computed(
  () => workspaces.value.find((item) => item.id === wsMenuId.value) ?? null,
);
const baseMenuTarget = computed(
  () => bases.value.find((item) => item.id === baseMenuId.value) ?? null,
);
const baseFormOpen = ref(false);
const baseFormMode = ref<'create' | 'edit'>('create');
const baseFormId = ref('');
const baseFormName = ref('');
const baseFormDescription = ref('');
const baseFormBusy = ref(false);
const changePasswordOpen = ref(false);
const changePasswordBusy = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const usernameOpen = ref(false);
const usernameBusy = ref(false);
const usernameDraft = ref('');
const avatarPickerOpen = ref(false);
const avatarPickerBusy = ref(false);
const avatarCandidates = ref<string[]>([]);
const avatarPick = ref('');
const avatarUploadInput = ref<HTMLInputElement | null>(null);
const avatarCropFile = ref<File | null>(null);

const currentAvatarUrl = computed(() =>
  resolveAvatarSrc({
    avatarUrl: auth.state.user?.avatarUrl,
    avatarSeed: auth.state.user?.avatarSeed,
    account: auth.state.user?.account,
    size: 96,
  }),
);

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
  return bases.value.filter((item) => {
    const name = item.name.toLowerCase();
    const desc = (item.description ?? '').toLowerCase();
    return name.includes(q) || desc.includes(q);
  });
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

/** 尚无工作区：隐藏左侧栏 */
const hideWorkspaceSidebar = computed(() => workspaces.value.length === 0);

/** 新账号尚无工作区：主区居中创建 */
const needsWorkspaceOnboard = computed(
  () => !loading.value && workspaces.value.length === 0,
);

/** 当前工作区尚无表格且可编辑：主区创建表格 + 成员 */
const needsBaseOnboard = computed(
  () =>
    Boolean(currentWorkspaceId.value) &&
    !basesLoading.value &&
    bases.value.length === 0 &&
    canEditCurrent.value,
);

function canManageWorkspace(ws: WorkspaceDto): boolean {
  return ws.role === 'owner' || ws.role === 'admin';
}

function canDeleteWorkspace(ws: WorkspaceDto): boolean {
  return ws.role === 'owner';
}

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

const expandedDescIds = ref(new Set<string>());
const truncatedDescIds = ref(new Set<string>());
const headlineEls = new Map<string, HTMLElement>();

function setHeadlineRef(id: string, el: unknown): void {
  if (el instanceof HTMLElement) {
    headlineEls.set(id, el);
  } else {
    headlineEls.delete(id);
  }
}

function isDescExpanded(id: string): boolean {
  return expandedDescIds.value.has(id);
}

function isDescTruncated(id: string): boolean {
  return truncatedDescIds.value.has(id);
}

function measureBaseHeadlines(): void {
  const next = new Set<string>();
  for (const [id, el] of headlineEls) {
    if (expandedDescIds.value.has(id)) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      next.add(id);
    }
  }
  truncatedDescIds.value = next;
}

function scheduleMeasureBaseHeadlines(): void {
  void nextTick(() => {
    measureBaseHeadlines();
  });
}

function toggleDescExpand(id: string): void {
  const next = new Set(expandedDescIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedDescIds.value = next;
  scheduleMeasureBaseHeadlines();
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

function placeOverflowMenu(
  btn: HTMLElement,
  menuWidth: number,
  estHeight: number,
): { top: number; left: number } {
  const rect = btn.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.right - menuWidth),
    window.innerWidth - menuWidth - 8,
  );
  const below = rect.bottom + 4;
  const top =
    below + estHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - estHeight - 4)
      : below;
  return { top, left };
}

function closeMenus(): void {
  userMenuOpen.value = false;
  wsMenuId.value = null;
  wsMenuPos.value = null;
  baseMenuId.value = null;
  baseMenuPos.value = null;
}

function toggleUserMenu(event: Event): void {
  event.stopPropagation();
  const next = !userMenuOpen.value;
  closeMenus();
  userMenuOpen.value = next;
}

function toggleWsMenu(id: string, event: Event): void {
  event.stopPropagation();
  if (wsMenuId.value === id) {
    closeMenus();
    return;
  }
  const btn = event.currentTarget as HTMLElement | null;
  if (!btn) return;
  closeMenus();
  wsMenuId.value = id;
  wsMenuPos.value = placeOverflowMenu(btn, 168, 160);
}

function toggleBaseMenu(id: string, event: Event): void {
  event.stopPropagation();
  if (baseMenuId.value === id) {
    closeMenus();
    return;
  }
  const btn = event.currentTarget as HTMLElement | null;
  if (!btn) return;
  closeMenus();
  baseMenuId.value = id;
  baseMenuPos.value = placeOverflowMenu(btn, 176, 260);
}

function onDocumentClick(): void {
  closeMenus();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenus();
}

async function loadWorkspaces(): Promise<void> {
  loading.value = true;
  try {
    workspaces.value = await endpoints.listWorkspaces();
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache('hub:workspaces', 'hub', workspaces.value);
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
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = (await localDb.getObjectCache('hub:workspaces')) as
        | WorkspaceDto[]
        | null;
      if (cached?.length) {
        workspaces.value = cached;
        const preferred =
          workspaces.value.find(
            (item) => item.id === String(route.query.ws ?? ''),
          )?.id ??
          workspaces.value[0]?.id ??
          '';
        if (preferred) {
          persistWorkspaceId(preferred);
          await loadBases();
        }
        toast('已从离线缓存打开工作区列表');
      } else {
        toast(messageOf(error) || '加载工作区失败');
      }
    } catch {
      toast(messageOf(error) || '加载工作区失败');
    }
  } finally {
    loading.value = false;
  }
}

async function loadBases(): Promise<void> {
  if (!currentWorkspaceId.value) return;
  basesLoading.value = true;
  const cacheKey = `hub:bases:${currentWorkspaceId.value}`;
  try {
    bases.value = await endpoints.listBases(currentWorkspaceId.value);
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'hub', bases.value);
  } catch (error) {
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = (await localDb.getObjectCache(cacheKey)) as BaseDto[] | null;
      if (cached?.length) {
        bases.value = cached;
        toast('已从离线缓存打开表格列表');
      } else {
        toast(messageOf(error) || '加载智能表格失败');
      }
    } catch {
      toast(messageOf(error) || '加载智能表格失败');
    }
  } finally {
    basesLoading.value = false;
  }
}

async function applyCreatedWorkspace(workspace: WorkspaceDto): Promise<void> {
  workspaces.value = [...workspaces.value, workspace];
  newWorkspaceName.value = '';
  toast('工作区已创建');
  persistWorkspaceId(workspace.id);
  await loadBases();
}

function parseInviteAccounts(raw: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(/[\s,;，；]+/)) {
    const next = part.trim().toLowerCase();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    list.push(next);
  }
  return list;
}

function collectOnboardInvites():
  | { ok: true; invites: Array<{ account: string; role: OnboardInviteRole }> }
  | { ok: false; message: string } {
  // 先把粘贴框里还没「加入」的账号并进列表（用默认权限）
  const pendingPaste = parseInviteAccounts(onboardInvitePaste.value);
  if (pendingPaste.length > 0) {
    const merged = applyPasteToOnboardRows(pendingPaste, false);
    if (!merged.ok) return merged;
  }

  const invites: Array<{ account: string; role: OnboardInviteRole }> = [];
  const seen = new Set<string>();
  for (const row of onboardInviteRows.value) {
    const account = row.account.trim().toLowerCase();
    if (!account) continue;
    const invalid = validateAccount(account);
    if (invalid) {
      return { ok: false, message: `用户名格式有误：${account}` };
    }
    if (seen.has(account)) {
      return { ok: false, message: `用户名重复：${account}` };
    }
    seen.add(account);
    invites.push({ account, role: row.role });
  }
  return { ok: true, invites };
}

function applyPasteToOnboardRows(
  accounts: string[],
  toastOnEmpty: boolean,
): { ok: true } | { ok: false; message: string } {
  if (accounts.length === 0) {
    if (toastOnEmpty) toast('请先粘贴用户名');
    return { ok: true };
  }
  const invalid = accounts.filter((item) => validateAccount(item));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `用户名格式有误：${invalid.slice(0, 3).join('、')}${
        invalid.length > 3 ? '…' : ''
      }`,
    };
  }
  const existing = new Set(
    onboardInviteRows.value.map((row) => row.account.trim().toLowerCase()),
  );
  const next = [...onboardInviteRows.value];
  let added = 0;
  for (const account of accounts) {
    if (existing.has(account)) continue;
    existing.add(account);
    next.push({
      key: onboardInviteKeySeq++,
      account,
      role: onboardInviteDefaultRole.value,
    });
    added += 1;
  }
  onboardInviteRows.value = next;
  onboardInvitePaste.value = '';
  if (toastOnEmpty && added === 0) {
    toast('用户名已在列表中');
  }
  return { ok: true };
}

function addOnboardInviteFromPaste(): void {
  const result = applyPasteToOnboardRows(
    parseInviteAccounts(onboardInvitePaste.value),
    true,
  );
  if (!result.ok) toast(result.message);
}

function removeOnboardInviteRow(key: number): void {
  onboardInviteRows.value = onboardInviteRows.value.filter(
    (row) => row.key !== key,
  );
}

function resetOnboardInviteRows(): void {
  onboardInvitePaste.value = '';
  onboardInviteRows.value = [];
}

async function inviteOnboardMembers(
  workspaceId: string,
  invites: Array<{ account: string; role: OnboardInviteRole }>,
): Promise<void> {
  if (invites.length === 0) return;

  let added = 0;
  const failed: string[] = [];
  for (const invite of invites) {
    try {
      await endpoints.inviteMember(
        workspaceId,
        invite.account,
        invite.role,
      );
      added += 1;
    } catch (error) {
      failed.push(`${invite.account}（${messageOf(error)}）`);
    }
  }
  resetOnboardInviteRows();
  if (failed.length > 0) {
    toast(
      invites.length === 1
        ? failed[0]!.replace(/^[^（]+（(.+)）$/, '$1')
        : `${failed.length} 个邀请失败：${failed.slice(0, 2).join('；')}${
            failed.length > 2 ? '…' : ''
          }`,
    );
  } else if (added > 0) {
    toast(`成员${added}人`);
  }
}

async function submitOnboardWorkspace(): Promise<void> {
  const name = newWorkspaceName.value.trim();
  if (!name) {
    toast('请填写名称');
    workspaceOnboardInput.value?.focus();
    return;
  }
  const collected = collectOnboardInvites();
  if (!collected.ok) {
    toast(collected.message);
    return;
  }
  if (creatingWorkspace.value) return;
  creatingWorkspace.value = true;
  try {
    const workspace = await endpoints.createWorkspace(name);
    await applyCreatedWorkspace(workspace);
    await inviteOnboardMembers(workspace.id, collected.invites);
  } catch (error) {
    toast(messageOf(error) || '创建工作区失败');
  } finally {
    creatingWorkspace.value = false;
  }
}

function focusWorkspaceOnboard(): void {
  workspaceOnboardInput.value?.focus();
  workspaceOnboardInput.value?.select();
}

async function createWorkspace(): Promise<void> {
  if (needsWorkspaceOnboard.value) {
    focusWorkspaceOnboard();
    return;
  }
  await promptDialog('新建工作区', '', {
    confirmLabel: '创建',
    onConfirm: async (raw) => {
      const name = raw.trim();
      if (!name) {
        toast('请填写名称');
        throw new Error('empty');
      }
      try {
        const workspace = await endpoints.createWorkspace(name);
        await applyCreatedWorkspace(workspace);
      } catch (error) {
        toast(messageOf(error) || '创建工作区失败');
        throw error;
      }
    },
  });
}

async function renameWorkspace(ws: WorkspaceDto): Promise<void> {
  closeMenus();
  if (!canManageWorkspace(ws)) return;
  await promptDialog('重命名工作区', ws.name, {
    confirmLabel: '保存',
    onConfirm: async (raw) => {
      const name = raw.trim();
      if (!name) {
        toast('请填写名称');
        throw new Error('empty');
      }
      if (name === ws.name) return;
      try {
        const updated = await endpoints.renameWorkspace(ws.id, name);
        workspaces.value = workspaces.value.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        );
        toast('已重命名');
      } catch (error) {
        toast(messageOf(error) || '重命名失败');
        throw error;
      }
    },
  });
}

async function togglePinWorkspace(ws: WorkspaceDto): Promise<void> {
  closeMenus();
  const next = !ws.pinned;
  try {
    await endpoints.pinWorkspace(ws.id, next);
    workspaces.value = await endpoints.listWorkspaces();
    toast(next ? '已置顶' : '已取消置顶');
  } catch (error) {
    toast(messageOf(error) || '置顶失败');
  }
}

async function deleteWorkspace(ws: WorkspaceDto): Promise<void> {
  closeMenus();
  if (!canDeleteWorkspace(ws)) return;
  const ok = await confirmDialog(
    `确定删除工作区「${ws.name}」？其中的智能表格将一并删除且无法恢复。`,
    { confirmLabel: '删除', danger: true },
  );
  if (!ok) return;
  try {
    await endpoints.deleteWorkspace(ws.id);
    workspaces.value = workspaces.value.filter((item) => item.id !== ws.id);
    toast('工作区已删除');
    if (currentWorkspaceId.value === ws.id) {
      const next = workspaces.value[0]?.id ?? '';
      if (next) {
        persistWorkspaceId(next);
        await loadBases();
      } else {
        currentWorkspaceId.value = '';
        bases.value = [];
        try {
          localStorage.removeItem(WS_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        void router.replace({ path: '/' });
      }
    }
  } catch (error) {
    toast(messageOf(error) || '删除失败');
  }
}

async function selectWorkspace(id: string): Promise<void> {
  if (!id || id === currentWorkspaceId.value) return;
  closeMenus();
  membersSectionOpen.value = false;
  baseQuery.value = '';
  persistWorkspaceId(id);
  await loadBases();
}

async function openWorkspaceMembers(workspaceId: string): Promise<void> {
  closeMenus();
  if (workspaceId !== currentWorkspaceId.value) {
    await selectWorkspace(workspaceId);
  }
  membersSectionOpen.value = true;
}

function openCreateBaseForm(): void {
  if (!currentWorkspaceId.value || !canEditCurrent.value) return;
  closeMenus();
  baseFormMode.value = 'create';
  baseFormId.value = '';
  baseFormName.value = '';
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
    // 重名等失败时保留移动弹窗，方便改目标或取消
    toast(messageOf(error) || '移动失败');
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

function onTemplateCreated(result: TemplateInstantiateResult): void {
  templateOpen.value = false;
  void loadBases().then(() => openBase(result.baseId));
}

async function signOut(): Promise<void> {
  const ok = await confirmDialog('确定退出当前账号？', {
    title: '退出登录',
    confirmLabel: '退出',
  });
  if (!ok) return;
  auth.signOut();
  await router.push('/login');
}

function refreshAvatarCandidates(): void {
  const entropy = auth.state.user?.account ?? '';
  avatarCandidates.value = Array.from({ length: 12 }, () =>
    createAvatarSeed(entropy),
  );
  avatarPick.value = avatarCandidates.value[0] ?? '';
}

function applyAvatarUser(user: {
  id: string;
  account: string;
  avatarSeed: string;
  avatarUrl?: string | null;
}): void {
  auth.updateUser({
    id: user.id,
    account: user.account,
    avatarSeed: user.avatarSeed,
    avatarUrl: user.avatarUrl ?? null,
  });
}

function openAvatarPicker(): void {
  refreshAvatarCandidates();
  avatarCropFile.value = null;
  avatarPickerBusy.value = false;
  avatarPickerOpen.value = true;
}

function closeAvatarPicker(): void {
  if (avatarPickerBusy.value) return;
  avatarCropFile.value = null;
  avatarPickerOpen.value = false;
}

function pickAvatarUpload(): void {
  avatarUploadInput.value?.click();
}

function onAvatarFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
    toast('请选择 JPG / PNG / WebP 图片');
    return;
  }
  // 原图可稍大，裁剪后再压到几十 KB
  if (file.size > 8 * 1024 * 1024) {
    toast('图片过大，请选择 8MB 以内的文件');
    return;
  }
  avatarCropFile.value = file;
}

function cancelAvatarCrop(): void {
  // 重选：直接打开文件选择器；选中后替换当前裁剪图，取消则留在裁剪页
  pickAvatarUpload();
}

async function submitAvatarPick(): Promise<void> {
  const seed = avatarPick.value.trim();
  if (!seed) {
    toast('请选择头像');
    return;
  }
  if (avatarPickerBusy.value) return;
  avatarPickerBusy.value = true;
  try {
    const user = await endpoints.updateAvatar(seed);
    applyAvatarUser(user);
    toast('头像已更新');
    avatarPickerOpen.value = false;
  } catch (error) {
    toast(messageOf(error) || '更新头像失败');
  } finally {
    avatarPickerBusy.value = false;
  }
}

async function submitAvatarCrop(blob: Blob): Promise<void> {
  if (avatarPickerBusy.value) return;
  avatarPickerBusy.value = true;
  try {
    const user = await endpoints.uploadAvatar(blob, 'avatar.jpg');
    applyAvatarUser(user);
    toast('自定义头像已保存');
    avatarCropFile.value = null;
    avatarPickerOpen.value = false;
  } catch (error) {
    toast(messageOf(error) || '上传头像失败');
  } finally {
    avatarPickerBusy.value = false;
  }
}

function openUsernameEditor(): void {
  usernameDraft.value = auth.state.user?.account ?? '';
  usernameBusy.value = false;
  usernameOpen.value = true;
}

function closeUsernameEditor(): void {
  if (usernameBusy.value) return;
  usernameOpen.value = false;
}

async function submitUsername(): Promise<void> {
  const next = usernameDraft.value.trim();
  const invalid = validateAccount(next);
  if (invalid) {
    toast(invalid);
    return;
  }
  if (usernameBusy.value) return;
  usernameBusy.value = true;
  try {
    const user = await endpoints.updateUsername(next);
    auth.updateUser({
      id: user.id,
      account: user.account,
      avatarSeed: user.avatarSeed,
      avatarUrl: user.avatarUrl ?? null,
    });
    toast('用户名已更新');
    usernameOpen.value = false;
  } catch (error) {
    toast(messageOf(error) || '修改用户名失败');
  } finally {
    usernameBusy.value = false;
  }
}

function openChangePassword(): void {
  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  changePasswordBusy.value = false;
  changePasswordOpen.value = true;
}

function closeChangePassword(): void {
  if (changePasswordBusy.value) return;
  changePasswordOpen.value = false;
}

async function submitChangePassword(): Promise<void> {
  const current = currentPassword.value;
  const next = newPassword.value;
  const confirm = confirmPassword.value;
  if (!current) {
    toast('请输入当前密码');
    return;
  }
  const passwordError = validatePassword(next);
  if (passwordError) {
    toast(passwordError);
    return;
  }
  if (next !== confirm) {
    toast('两次输入的新密码不一致');
    return;
  }
  if (current === next) {
    toast('新密码不能与当前密码相同');
    return;
  }
  if (changePasswordBusy.value) return;
  changePasswordBusy.value = true;
  try {
    await endpoints.changePassword(current, next);
    toast('密码已修改');
    changePasswordOpen.value = false;
  } catch (error) {
    toast(messageOf(error) || '修改密码失败');
  } finally {
    changePasswordBusy.value = false;
  }
}

async function deleteAccount(): Promise<void> {
  await promptDialog('注销账号', '', {
    message: '注销后账号及其拥有的工作区将永久删除，且无法恢复。请输入登录密码确认。',
    inputType: 'password',
    placeholder: '请输入登录密码',
    confirmLabel: '确认注销',
    danger: true,
    onConfirm: async (raw) => {
      const password = raw.trim();
      if (!password) {
        toast('请输入密码');
        throw new Error('empty');
      }
      try {
        await endpoints.deleteAccount(password);
        toast('账号已注销');
        auth.signOut();
        await router.push('/login');
      } catch (error) {
        toast(messageOf(error) || '注销失败');
        throw error;
      }
    },
  });
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

watch(needsWorkspaceOnboard, async (need) => {
  if (!need) return;
  await nextTick();
  focusWorkspaceOnboard();
});

watch(
  bases,
  () => {
    const alive = new Set(bases.value.map((item) => item.id));
    const nextExpanded = new Set(
      [...expandedDescIds.value].filter((id) => alive.has(id)),
    );
    expandedDescIds.value = nextExpanded;
    scheduleMeasureBaseHeadlines();
  },
  { flush: 'post' },
);

const liveUnsubs: Array<() => void> = [];

function onHomeLive(event: LiveEvent): void {
  if (event.kind === 'member.changed') {
    const meta = event.meta ?? {};
    const action = meta.action;
    if (
      event.entityId &&
      event.entityId === auth.state.user?.id &&
      (action === 'avatar' || action === 'username')
    ) {
      auth.updateUser({
        id: auth.state.user.id,
        account:
          typeof meta.account === 'string'
            ? meta.account
            : auth.state.user.account,
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
  if (
    event.kind.startsWith('workspace.') ||
    event.kind === 'member.changed'
  ) {
    void loadWorkspaces();
  }
  if (
    event.kind.startsWith('base.') ||
    event.kind === 'member.changed' ||
    event.kind === 'permission.changed'
  ) {
    void loadBases();
  }
}

watch(
  currentWorkspaceId,
  (id) => {
    if (id) liveSocket.connect({ workspaceId: id });
    else liveSocket.disconnect();
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('resize', scheduleMeasureBaseHeadlines);
  liveUnsubs.push(
    liveBus.on('workspace.*', onHomeLive),
    liveBus.on('base.*', onHomeLive),
    liveBus.on('member.changed', onHomeLive),
    liveBus.on('permission.changed', onHomeLive),
  );
  void loadWorkspaces();
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('resize', scheduleMeasureBaseHeadlines);
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  liveSocket.disconnect();
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

      <div class="topbar-actions">
        <NotificationBell />
        <div class="user-chip" @click.stop>
          <button
            class="user-chip-trigger"
            type="button"
            title="账号"
            aria-label="账号菜单"
            aria-haspopup="menu"
            :aria-expanded="userMenuOpen"
            data-testid="avatar-open"
            @click="toggleUserMenu"
          >
            <span class="user-name-text">
              {{ auth.state.user?.account }}
            </span>
            <span class="avatar-btn" aria-hidden="true">
              <img
                class="avatar-img"
                :src="currentAvatarUrl"
                alt=""
                width="28"
                height="28"
                draggable="false"
              />
            </span>
          </button>
          <div
            v-if="userMenuOpen"
            class="menu user-menu"
            data-testid="user-menu"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              @click="closeMenus(); openAvatarPicker()"
            >
              更新头像
            </button>
            <button
              type="button"
              data-testid="username-open"
              role="menuitem"
              @click="closeMenus(); openUsernameEditor()"
            >
              修改用户名
            </button>
            <button
              type="button"
              data-testid="change-password"
              role="menuitem"
              @click="closeMenus(); openChangePassword()"
            >
              修改密码
            </button>
            <button
              v-if="auth.state.user?.installAdmin"
              type="button"
              data-testid="admin-users-menu"
              role="menuitem"
              @click="closeMenus(); router.push('/admin/users')"
            >
              用户管理
            </button>
            <button
              v-if="auth.state.user?.installAdmin"
              type="button"
              data-testid="admin-feedback-menu"
              role="menuitem"
              @click="closeMenus(); router.push('/admin/feedback')"
            >
              反馈后台
            </button>
            <button
              v-if="auth.state.user?.installAdmin"
              type="button"
              data-testid="admin-activity-menu"
              role="menuitem"
              @click="closeMenus(); router.push('/admin/activity')"
            >
              日志管理
            </button>
            <button type="button" role="menuitem" @click="closeMenus(); signOut()">
              退出
            </button>
            <button
              type="button"
              class="danger"
              data-testid="delete-account"
              role="menuitem"
              @click="closeMenus(); deleteAccount()"
            >
              注销
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="body" :class="{ 'body-onboard': hideWorkspaceSidebar }">
      <aside v-if="!hideWorkspaceSidebar" class="sidebar" data-testid="hub-sidebar">
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
        <PageLoading v-if="loading" variant="inline" label="加载工作区…" />
        <ul v-else class="ws-list" @scroll="closeMenus">
          <li v-for="ws in filteredWorkspaces" :key="ws.id" class="ws-row">
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
            <div class="ws-more" @click.stop>
              <button
                type="button"
                class="more-btn ws-more-btn"
                :aria-expanded="wsMenuId === ws.id"
                :data-testid="`workspace-menu-${ws.id}`"
                @click="toggleWsMenu(ws.id, $event)"
              >
                ⋯
              </button>
            </div>
          </li>
          <li v-if="filteredWorkspaces.length === 0" class="hint">
            无匹配结果
          </li>
        </ul>
      </aside>

      <Teleport to="body">
        <div
          v-if="wsMenuTarget && wsMenuPos"
          class="menu row-menu ws-menu-fixed"
          data-testid="workspace-row-menu"
          :style="{ top: `${wsMenuPos.top}px`, left: `${wsMenuPos.left}px` }"
          @click.stop
        >
          <button
            type="button"
            data-testid="workspace-pin"
            @click="togglePinWorkspace(wsMenuTarget)"
          >
            {{ wsMenuTarget.pinned ? '取消置顶' : '置顶' }}
          </button>
          <button
            v-if="canManageWorkspace(wsMenuTarget)"
            type="button"
            data-testid="workspace-rename"
            @click="renameWorkspace(wsMenuTarget)"
          >
            重命名
          </button>
          <button
            type="button"
            data-testid="workspace-members"
            @click="openWorkspaceMembers(wsMenuTarget.id)"
          >
            成员
          </button>
          <button
            v-if="canDeleteWorkspace(wsMenuTarget)"
            type="button"
            class="danger"
            data-testid="workspace-delete"
            @click="deleteWorkspace(wsMenuTarget)"
          >
            删除
          </button>
        </div>
      </Teleport>

      <main
        class="main"
        :class="{ 'main-onboard': hideWorkspaceSidebar }"
      >
        <PageLoading
          v-if="loading && hideWorkspaceSidebar"
          label="加载工作区…"
        />
        <div
          v-else-if="needsWorkspaceOnboard"
          class="workspace-setup"
          data-testid="workspace-onboard"
        >
          <div class="base-setup-sheet">
            <section class="base-setup-create">
              <h2>创建工作区</h2>
              <form
                class="base-create-form"
                @submit.prevent="submitOnboardWorkspace"
              >
                <label class="base-create-field">
                  <span class="base-create-label">
                    工作区名称<em class="required-star">*</em>
                  </span>
                  <input
                    ref="workspaceOnboardInput"
                    v-model="newWorkspaceName"
                    class="base-create-input"
                    data-testid="workspace-onboard-name"
                    maxlength="64"
                    placeholder="例如：销售一部"
                    autocomplete="off"
                    :disabled="creatingWorkspace"
                  />
                </label>
                <div class="base-create-field">
                  <span class="base-create-label">邀请成员</span>
                  <textarea
                    v-model="onboardInvitePaste"
                    class="base-create-textarea workspace-invite-textarea"
                    data-testid="workspace-onboard-invite"
                    maxlength="2000"
                    rows="3"
                    placeholder="可选，每行一个用户名，也可用逗号分隔"
                    :disabled="creatingWorkspace"
                  />
                  <div class="workspace-invite-tools">
                    <label class="workspace-invite-default-role">
                      <span class="base-create-label">默认权限</span>
                      <select
                        v-model="onboardInviteDefaultRole"
                        class="base-create-input workspace-invite-role-select"
                        data-testid="workspace-onboard-invite-role"
                        :disabled="creatingWorkspace"
                      >
                        <option value="editor">可编辑</option>
                        <option value="viewer">只读</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                    <button
                      class="workspace-invite-add"
                      type="button"
                      data-testid="workspace-onboard-invite-add"
                      :disabled="creatingWorkspace"
                      @click="addOnboardInviteFromPaste"
                    >
                      加入列表
                    </button>
                  </div>
                  <div
                    v-if="onboardInviteRows.length > 0"
                    class="workspace-invite-list"
                    data-testid="workspace-onboard-invite-list"
                  >
                    <div
                      v-for="row in onboardInviteRows"
                      :key="row.key"
                      class="workspace-invite-row"
                    >
                      <span class="workspace-invite-account">{{ row.account }}</span>
                      <select
                        v-model="row.role"
                        class="base-create-input workspace-invite-role-select"
                        :disabled="creatingWorkspace"
                      >
                        <option value="editor">可编辑</option>
                        <option value="viewer">只读</option>
                        <option value="admin">管理员</option>
                      </select>
                      <button
                        class="workspace-invite-remove"
                        type="button"
                        aria-label="移除"
                        :disabled="creatingWorkspace"
                        @click="removeOnboardInviteRow(row.key)"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
                <div class="base-create-actions">
                  <button
                    class="btn btn-primary base-create-submit"
                    type="submit"
                    data-testid="workspace-onboard-submit"
                    :disabled="creatingWorkspace"
                  >
                    {{ creatingWorkspace ? '创建中…' : '创建' }}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>

        <template v-else>
        <div v-if="currentWorkspace" class="main-head">
          <div class="main-head-title">
            <div class="main-title-row">
              <h1>{{ currentWorkspace.name }}</h1>
              <button
                class="members-btn"
                type="button"
                data-testid="hub-members"
                :aria-pressed="membersSectionOpen"
                :class="{ active: membersSectionOpen }"
                @click.stop="membersSectionOpen = !membersSectionOpen"
              >
                <svg
                  class="members-icon"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 1.5c-2.9 0-8.5 1.45-8.5 4.35V19a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-2.15c0-2.9-5.6-4.35-8.5-4.35ZM16.75 7a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Zm1.6 6.55c2.15.55 4.65 1.7 4.65 3.55V18a1 1 0 0 1-1 1h-3.2a2.6 2.6 0 0 0 .3-1.15v-1.75c0-.95-.5-1.75-1.35-2.4.2-.05.4-.1.6-.15Z"
                  />
                </svg>
                <span>成员</span>
              </button>
            </div>
            <p class="sub">{{ bases.length }} 个智能表格</p>
          </div>
        </div>

        <MembersPanel
          v-if="currentWorkspaceId && membersSectionOpen && !basesLoading"
          class="members-inline"
          :workspace-id="currentWorkspaceId"
          embedded
          embedded-title="工作区成员"
          :can-manage="
            currentWorkspace ? canManageWorkspace(currentWorkspace) : false
          "
        />

        <div
          v-if="!basesLoading && !needsBaseOnboard"
          class="main-toolbar"
        >
          <div class="base-search">
            <input
              v-model="baseQuery"
              data-testid="hub-base-search"
              placeholder="搜索智能表"
              aria-label="搜索智能表"
            />
          </div>
          <div v-if="canEditCurrent" class="create-actions">
            <button
              class="btn btn-primary"
              type="button"
              data-testid="create-base"
              @click="openCreateBaseForm"
            >
              新建表格
            </button>
            <button
              class="btn btn-template"
              type="button"
              data-testid="hub-template"
              @click="openTemplate"
            >
              从模板新建
            </button>
          </div>
        </div>

        <PageLoading v-if="basesLoading" label="加载表格…" />

        <div
          v-else-if="needsBaseOnboard"
          class="empty-panel empty-panel-center"
          data-testid="base-onboard"
        >
          <div class="empty-icon">▦</div>
          <h2>创建第一张智能表格</h2>
          <p>从空白开始，或用模板快速搭好结构。</p>
          <div class="empty-actions">
            <button
              class="btn btn-primary"
              type="button"
              data-testid="create-base"
              @click="openCreateBaseForm"
            >
              新建表格
            </button>
            <button
              class="btn btn-template"
              type="button"
              data-testid="base-onboard-template"
              @click="openTemplate"
            >
              从模板新建
            </button>
          </div>
        </div>

        <div
          v-else-if="bases.length === 0"
          class="empty-panel empty-panel-center"
          data-testid="base-list"
        >
          <div class="empty-icon">▦</div>
          <h2>暂无智能表格</h2>
          <p>当前角色无法新建，可联系工作区管理员。</p>
        </div>

        <div
          v-else-if="filteredBases.length === 0"
          class="empty-panel"
          data-testid="base-list"
        >
          <p>无匹配结果</p>
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
              <div class="base-headline-row">
                <div
                  class="base-headline"
                  :class="{ 'is-expanded': isDescExpanded(base.id) }"
                  :ref="(el) => setHeadlineRef(base.id, el)"
                  data-testid="base-headline"
                >
                  <span class="base-title">{{ base.name }}</span>
                  <span
                    v-if="base.description"
                    class="base-desc"
                    data-testid="base-desc"
                  >{{ base.description }}</span>
                </div>
                <button
                  v-if="
                    base.description &&
                    (isDescExpanded(base.id) || isDescTruncated(base.id))
                  "
                  type="button"
                  class="base-desc-toggle"
                  data-testid="base-desc-toggle"
                  @click.stop="toggleDescExpand(base.id)"
                >
                  {{ isDescExpanded(base.id) ? '收起' : '展开' }}
                </button>
              </div>
            </div>
            <div class="base-aside">
              <span class="base-time">
                {{ formatTime(base.updatedAt) }}
                <span v-if="!isOwnedBase(base)" class="badge">共享</span>
              </span>
              <div class="base-more" @click.stop>
                <button
                  type="button"
                  class="more-btn"
                  data-testid="base-row-actions"
                  :aria-expanded="baseMenuId === base.id"
                  :aria-label="`${base.name} 的操作`"
                  @click="toggleBaseMenu(base.id, $event)"
                >
                  ⋯
                </button>
              </div>
            </div>
          </article>
        </div>

        <Teleport to="body">
          <div
            v-if="baseMenuTarget && baseMenuPos"
            class="menu row-menu base-menu-fixed"
            data-testid="base-row-menu"
            :style="{ top: `${baseMenuPos.top}px`, left: `${baseMenuPos.left}px` }"
            @click.stop
          >
            <button
              v-if="canEditCurrent && isOwnedBase(baseMenuTarget)"
              type="button"
              @click="openEditBaseForm(baseMenuTarget)"
            >
              编辑
            </button>
            <button
              v-if="canEditCurrent && isOwnedBase(baseMenuTarget)"
              type="button"
              data-testid="base-move-up"
              :disabled="ownedIndex(baseMenuTarget) <= 0"
              @click="moveOrder(baseMenuTarget, -1)"
            >
              上移
            </button>
            <button
              v-if="canEditCurrent && isOwnedBase(baseMenuTarget)"
              type="button"
              data-testid="base-move-down"
              :disabled="ownedIndex(baseMenuTarget) >= ownedBases.length - 1"
              @click="moveOrder(baseMenuTarget, 1)"
            >
              下移
            </button>
            <button
              v-if="canEditCurrent && isOwnedBase(baseMenuTarget)"
              type="button"
              data-testid="base-move"
              :disabled="editableWorkspaces.length === 0"
              :title="
                editableWorkspaces.length === 0
                  ? '没有可移入的其他工作区'
                  : undefined
              "
              @click="openMove(baseMenuTarget)"
            >
              移动到工作区
            </button>
            <button
              type="button"
              data-testid="base-permissions"
              @click="openPermissions(baseMenuTarget)"
            >
              内容权限
            </button>
            <button
              v-if="canEditCurrent && isOwnedBase(baseMenuTarget)"
              type="button"
              class="danger"
              data-testid="base-delete"
              @click="deleteBase(baseMenuTarget)"
            >
              删除
            </button>
          </div>
        </Teleport>
        </template>
      </main>
    </div>

    <input
      ref="avatarUploadInput"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden-file"
      data-testid="avatar-upload-input"
      @change="onAvatarFileChange"
    />

    <div
      v-if="avatarPickerOpen"
      class="modal-mask"
      @click.self="closeAvatarPicker"
    >
      <section class="dialog avatar-dialog" data-testid="avatar-picker-dialog">
        <header class="dialog-head">
          <h3>{{ avatarCropFile ? '裁剪头像' : '选择头像' }}</h3>
          <button
            class="icon-btn"
            type="button"
            :disabled="avatarPickerBusy"
            @click="closeAvatarPicker"
          >
            ×
          </button>
        </header>

        <AvatarCropper
          v-if="avatarCropFile"
          :file="avatarCropFile"
          :busy="avatarPickerBusy"
          @cancel="cancelAvatarCrop"
          @confirm="submitAvatarCrop"
        />

        <template v-else>
          <p class="dialog-desc avatar-desc">
            选一个卡通头像，或上传自己的照片。
          </p>
          <div class="avatar-toolbar">
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="avatarPickerBusy"
              data-testid="avatar-refresh"
              @click="refreshAvatarCandidates"
            >
              换一批
            </button>
            <button
              class="btn btn-ghost avatar-upload-btn"
              type="button"
              :disabled="avatarPickerBusy"
              data-testid="avatar-upload"
              @click="pickAvatarUpload"
            >
              上传图片
            </button>
          </div>
          <div class="avatar-grid" data-testid="avatar-grid">
            <button
              v-for="seed in avatarCandidates"
              :key="seed"
              type="button"
              class="avatar-option"
              :class="{ selected: seed === avatarPick }"
              :disabled="avatarPickerBusy"
              :data-testid="`avatar-option-${seed}`"
              @click="avatarPick = seed"
            >
              <img
                :src="buildAvatarUrl(seed, seed, 96)"
                alt=""
                width="64"
                height="64"
                draggable="false"
              />
            </button>
          </div>
          <div class="dialog-actions avatar-actions">
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="avatarPickerBusy"
              @click="closeAvatarPicker"
            >
              取消
            </button>
            <button
              class="btn btn-primary"
              type="button"
              data-testid="avatar-submit"
              :disabled="avatarPickerBusy"
              @click="submitAvatarPick"
            >
              {{ avatarPickerBusy ? '保存中…' : '使用此头像' }}
            </button>
          </div>
        </template>
      </section>
    </div>

    <div
      v-if="usernameOpen"
      class="modal-mask"
      @click.self="closeUsernameEditor"
    >
      <section class="dialog" data-testid="username-dialog">
        <header class="dialog-head">
          <h3>修改用户名</h3>
          <button
            class="icon-btn"
            type="button"
            :disabled="usernameBusy"
            @click="closeUsernameEditor"
          >
            ×
          </button>
        </header>
        <form class="password-form" @submit.prevent="submitUsername">
          <label class="field">
            <span>用户名</span>
            <input
              v-model="usernameDraft"
              type="text"
              autocomplete="username"
              data-testid="username-input"
              :minlength="ACCOUNT_MIN_LENGTH"
              :maxlength="ACCOUNT_MAX_LENGTH"
              :disabled="usernameBusy"
            />
          </label>
          <p class="password-hint">{{ ACCOUNT_HINT }}</p>
          <div class="dialog-actions">
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="usernameBusy"
              @click="closeUsernameEditor"
            >
              取消
            </button>
            <button
              class="btn btn-primary"
              type="submit"
              data-testid="username-submit"
              :disabled="usernameBusy"
            >
              {{ usernameBusy ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div
      v-if="changePasswordOpen"
      class="modal-mask"
      @click.self="closeChangePassword"
    >
      <section class="dialog" data-testid="change-password-dialog">
        <header class="dialog-head">
          <h3>修改密码</h3>
          <button
            class="icon-btn"
            type="button"
            :disabled="changePasswordBusy"
            @click="closeChangePassword"
          >
            ×
          </button>
        </header>
        <form class="password-form" @submit.prevent="submitChangePassword">
          <label class="field">
            <span>当前密码</span>
            <input
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              data-testid="change-password-current"
              :disabled="changePasswordBusy"
            />
          </label>
          <label class="field">
            <span>新密码</span>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              data-testid="change-password-new"
              :disabled="changePasswordBusy"
            />
          </label>
          <label class="field">
            <span>确认新密码</span>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              data-testid="change-password-confirm"
              :disabled="changePasswordBusy"
            />
          </label>
          <p class="password-hint">{{ PASSWORD_HINT }}</p>
          <div class="dialog-actions">
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="changePasswordBusy"
              @click="closeChangePassword"
            >
              取消
            </button>
            <button
              class="btn btn-primary"
              type="submit"
              data-testid="change-password-submit"
              :disabled="changePasswordBusy"
            >
              {{ changePasswordBusy ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </section>
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
        :can-manage="
          currentWorkspace ? canManageWorkspace(currentWorkspace) : false
        "
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
          <span>名称<em class="required-star">*</em></span>
          <input
            v-model="baseFormName"
            data-testid="base-form-name"
            maxlength="100"
            placeholder="表格名称"
            required
            @keyup.enter="submitBaseForm"
          />
        </label>
        <label class="field">
          <span>描述</span>
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
  overflow: hidden;
}

.topbar {
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--border);
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

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.create-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-template {
  color: var(--brand-strong);
  border-color: rgba(45, 140, 240, 0.45);
  background: #f3f8ff;
}

.btn-template:hover:not(:disabled) {
  color: var(--brand-strong);
  border-color: var(--brand);
  background: #e8f3ff;
}

.user-chip {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}

.user-chip-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  height: 36px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.user-chip-trigger:hover,
.user-chip-trigger[aria-expanded='true'] {
  background: var(--bg-hover);
}

.user-name-text {
  min-width: 0;
  max-width: 140px;
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-chip-trigger:hover .user-name-text,
.user-chip-trigger[aria-expanded='true'] .user-name-text {
  color: var(--text);
}

.avatar-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  flex: none;
  overflow: hidden;
  box-shadow: inset 0 -1px 0 rgba(31, 35, 41, 0.06);
  pointer-events: none;
}

.user-menu {
  top: calc(100% + 8px);
  right: 0;
  left: auto;
  min-width: 168px;
  z-index: 40;
}

.avatar-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  background: #e8f3ff;
}

.avatar-dialog {
  width: min(420px, 92vw);
}

.avatar-desc {
  margin-bottom: 12px;
}

.avatar-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.avatar-upload-btn {
  color: var(--brand-strong);
  border-color: rgba(45, 140, 240, 0.35);
  background: #f3f8ff;
}

.avatar-upload-btn:hover:not(:disabled) {
  background: #e8f3ff;
  border-color: rgba(45, 140, 240, 0.55);
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-muted);
}

.avatar-option {
  aspect-ratio: 1;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.12s ease;
}

.avatar-option img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(31, 35, 41, 0.08);
}

.avatar-option:hover:not(:disabled) {
  border-color: rgba(45, 140, 240, 0.4);
  transform: translateY(-1px);
}

.avatar-option.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.18);
}

.avatar-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.avatar-actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.hidden-file {
  display: none;
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
  overflow: hidden;
}

.body-onboard {
  grid-template-columns: minmax(0, 1fr);
}

.sidebar {
  background: #fff;
  border-right: 1px solid var(--border);
  padding: 14px 10px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.ws-row {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: 9px;
  z-index: 0;
}

.ws-row:has(.menu) {
  z-index: 40;
}

.ws-row:hover,
.ws-row:focus-within {
  background: #f5f6f8;
}

.ws-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 28px 10px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}

.ws-item:hover {
  background: transparent;
}

.ws-item.active {
  background: #e8f3ff;
}

.ws-row:has(.ws-item.active) {
  background: #e8f3ff;
}

.ws-more {
  position: absolute;
  top: 6px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.ws-row:hover .ws-more,
.ws-row:focus-within .ws-more,
.ws-more:has(.menu) {
  opacity: 1;
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

.more-btn:hover {
  background: var(--bg-hover);
}

.ws-more-btn {
  width: 24px;
  height: 24px;
  font-size: 14px;
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
  min-height: 0;
  overflow-y: auto;
  padding: 28px 36px 40px;
  max-width: 1080px;
}

.main-onboard {
  max-width: none;
  padding: 28px 36px 56px;
}

.base-setup {
  width: min(560px, 100%);
  margin-top: 8px;
}

.base-setup-sheet {
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(31, 35, 41, 0.05);
}

.base-setup-create {
  padding: 24px 24px 22px;
}

.base-setup-create h2 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.base-create-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.base-create-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.base-create-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #646a73;
}

.base-create-input,
.base-create-textarea {
  width: 100%;
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  font-size: 14px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.base-create-input {
  height: 42px;
  padding: 0 14px;
}

.base-create-textarea {
  min-height: 72px;
  padding: 10px 14px;
  resize: none;
  line-height: 1.55;
  font-family: inherit;
}

.base-create-input:focus,
.base-create-textarea:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.16);
}

.base-create-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  margin-top: 4px;
}

.base-create-submit {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
}

.base-template-link {
  padding: 0;
  border: 0;
  background: none;
  color: #646a73;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
}

.base-template-link:hover:not(:disabled) {
  color: var(--brand);
}

.base-template-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.main-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.main-head-title {
  min-width: 0;
}

.main-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.members-btn {
  height: 30px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(45, 140, 240, 0.28);
  border-radius: 8px;
  background: #f3f8ff;
  color: var(--brand-strong);
  font-size: 13px;
  cursor: pointer;
  flex: none;
}

.members-btn:hover {
  background: #e8f3ff;
  border-color: rgba(45, 140, 240, 0.45);
}

.members-btn.active {
  background: #e8f3ff;
  border-color: rgba(45, 140, 240, 0.55);
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.12);
}

.members-icon {
  display: block;
}

.members-inline {
  margin: 16px 0 8px;
}

.main-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
  flex-wrap: wrap;
}

.main-toolbar .create-actions {
  margin-left: auto;
}

.base-search {
  flex: 1;
  min-width: 180px;
  max-width: 360px;
}

.base-search input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.base-search input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.12);
}

.workspace-setup {
  width: min(560px, 100%);
  margin: 48px auto 0;
}

.workspace-invite-textarea {
  min-height: 88px;
}

.workspace-invite-tools {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
}

.workspace-invite-default-role {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.workspace-invite-role-select {
  width: 108px;
  flex: none;
  cursor: pointer;
  padding-left: 10px;
  padding-right: 28px;
}

.workspace-invite-add {
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  background: #fff;
  color: var(--brand);
  font-size: 13px;
  cursor: pointer;
  flex: none;
}

.workspace-invite-add:hover:not(:disabled) {
  border-color: var(--brand);
  background: rgba(45, 140, 240, 0.06);
}

.workspace-invite-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.workspace-invite-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #e8eaed;
  border-radius: 10px;
  background: #fafbfc;
}

.workspace-invite-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-invite-account {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #1f2329;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-invite-list .workspace-invite-role-select {
  height: 34px;
}

.workspace-invite-remove {
  width: 28px;
  height: 34px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8f959e;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.workspace-invite-remove:hover:not(:disabled) {
  background: #f0f1f2;
  color: #646a73;
}

.workspace-invite-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  list-style: none;
}

.main-hint {
  padding: 24px 0;
}

.base-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.base-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 0;
  border-bottom: 1px solid #eef0f3;
  border-radius: 0;
  cursor: pointer;
  transition: background 0.12s ease;
}

.base-item:last-child {
  border-bottom: 0;
}

.base-item:hover {
  background: #f7f8fa;
}

.base-tile {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e8f3ff;
  color: var(--brand);
  font-size: 16px;
  flex: none;
}

.base-meta {
  min-width: 0;
  flex: 1;
}

.base-headline-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.base-headline {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.4;
}

.base-headline.is-expanded {
  white-space: normal;
  overflow: visible;
  word-break: break-word;
}

.base-title {
  font-weight: 600;
  color: var(--text);
}

.base-desc {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
}

.base-desc-toggle {
  flex: none;
  height: 21px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--brand);
  font-size: 12px;
  line-height: 21px;
  cursor: pointer;
  white-space: nowrap;
}

.base-desc-toggle:hover {
  text-decoration: underline;
}

.base-aside {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-left: auto;
}

.base-time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
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
  opacity: 0;
  transition: opacity 0.12s ease;
}

.base-item:hover .base-more,
.base-item:focus-within .base-more,
.base-more:has(.more-btn[aria-expanded='true']) {
  opacity: 1;
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
  animation: hub-menu-in 0.14s ease;
}

.menu.ws-menu-fixed,
.menu.base-menu-fixed {
  position: fixed;
  top: 0;
  right: auto;
  z-index: 2500;
}

.menu button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

@keyframes hub-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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

.empty-panel {
  margin-top: 28px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.empty-panel-center {
  margin: 56px auto 0;
  align-items: center;
  text-align: center;
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
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.empty-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.empty-panel > .btn {
  align-self: flex-start;
}

.empty-panel-center > .btn,
.empty-panel-center .empty-actions {
  align-self: center;
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
  border: 1px solid var(--border-strong, #d0d3d6);
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font: inherit;
  font-size: 14px;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.field input,
.field select {
  height: 36px;
  padding: 0 12px;
}

.field textarea {
  min-height: 80px;
  padding: 10px 12px;
  line-height: 1.5;
  resize: none;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--brand, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.14);
}

.field input::placeholder,
.field textarea::placeholder {
  color: var(--text-tertiary, #8f959e);
}

.required-star {
  margin-left: 2px;
  color: #f54a45;
  font-style: normal;
  font-weight: 600;
}

.password-form {
  display: flex;
  flex-direction: column;
}

.password-form .field:first-child {
  margin-top: 12px;
}

.password-hint {
  margin: 10px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.5;
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
    overflow: hidden;
  }

  .main {
    padding: 20px 16px 32px;
  }

  .crumb {
    display: none;
  }

  .user-name-text {
    max-width: 88px;
  }

  .base-more {
    opacity: 1;
  }

  .main-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .main-toolbar .create-actions {
    margin-left: 0;
  }

  .base-search {
    max-width: none;
  }

  .create-actions {
    justify-content: stretch;
  }

  .create-actions .btn {
    flex: 1;
  }
}
</style>
