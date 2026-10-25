<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  PASSWORD_HINT,
  createAvatarSeed,
  validateAccount,
  validatePassword,
} from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import AvatarCropper from '../components/AvatarCropper.vue';
import MembersPanel from '../components/MembersPanel.vue';
import PermissionsPanel from '../components/PermissionsPanel.vue';
import TemplatePanel from '../components/TemplatePanel.vue';
import { auth } from '../stores/auth';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { buildAvatarUrl, resolveAvatarSrc } from '../utils/avatar';
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
const loading = ref(false);
const basesLoading = ref(false);
const templateOpen = ref(false);
const membersSectionOpen = ref(false);
const permissionsOpen = ref(false);
const permissionsBaseId = ref('');
const moveOpen = ref(false);
const moveBaseId = ref('');
const moveTargetId = ref('');
const createMenuOpen = ref(false);
const rowMenuId = ref<string | null>(null);
const wsMenuId = ref<string | null>(null);
const wsMenuPos = ref<{ top: number; left: number } | null>(null);
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
const newBaseName = ref('');
const newBaseDescription = ref('');
const creatingBase = ref(false);
const baseOnboardInput = ref<HTMLInputElement | null>(null);

const wsMenuTarget = computed(
  () => workspaces.value.find((item) => item.id === wsMenuId.value) ?? null,
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
  wsMenuId.value = null;
  wsMenuPos.value = null;
}

function toggleWsMenu(id: string, event: Event): void {
  event.stopPropagation();
  rowMenuId.value = null;
  createMenuOpen.value = false;
  if (wsMenuId.value === id) {
    wsMenuId.value = null;
    wsMenuPos.value = null;
    return;
  }
  const btn = event.currentTarget as HTMLElement | null;
  const rect = btn?.getBoundingClientRect();
  if (!rect) return;
  const menuWidth = 168;
  const left = Math.min(
    Math.max(8, rect.right - menuWidth),
    window.innerWidth - menuWidth - 8,
  );
  // 优先在按钮下方展开；靠近底部时翻到上方
  const below = rect.bottom + 4;
  const estHeight = 140;
  const top =
    below + estHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - estHeight - 4)
      : below;
  wsMenuId.value = id;
  wsMenuPos.value = { top, left };
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
      return { ok: false, message: `账号格式有误：${account}` };
    }
    if (seen.has(account)) {
      return { ok: false, message: `账号重复：${account}` };
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
    if (toastOnEmpty) toast('请先粘贴账号');
    return { ok: true };
  }
  const invalid = accounts.filter((item) => validateAccount(item));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `账号格式有误：${invalid.slice(0, 3).join('、')}${
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
    toast('账号已在列表中');
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
    toast(`已邀请 ${added} 人`);
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

function focusBaseOnboard(): void {
  baseOnboardInput.value?.focus();
  baseOnboardInput.value?.select();
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
  if (needsBaseOnboard.value) {
    void nextTick(() => {
      baseOnboardInput.value?.focus();
      baseOnboardInput.value?.select();
    });
    return;
  }
  baseFormMode.value = 'create';
  baseFormId.value = '';
  baseFormName.value = '';
  baseFormDescription.value = '';
  baseFormOpen.value = true;
}

async function submitOnboardBase(): Promise<void> {
  if (!currentWorkspaceId.value || !canEditCurrent.value) return;
  const name = newBaseName.value.trim();
  if (!name) {
    toast('请填写名称');
    baseOnboardInput.value?.focus();
    return;
  }
  if (creatingBase.value) return;
  creatingBase.value = true;
  try {
    const description = newBaseDescription.value.trim() || null;
    const base = await endpoints.createBase(
      currentWorkspaceId.value,
      name,
      description,
    );
    newBaseName.value = '';
    newBaseDescription.value = '';
    toast('已创建');
    await loadBases();
    openBase(base.id);
  } catch (error) {
    toast(messageOf(error) || '创建表格失败');
  } finally {
    creatingBase.value = false;
  }
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

function toggleRowMenu(baseId: string, event: MouseEvent): void {
  event.stopPropagation();
  rowMenuId.value = rowMenuId.value === baseId ? null : baseId;
  wsMenuId.value = null;
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
  name: string;
  avatarSeed: string;
  avatarUrl?: string | null;
}): void {
  auth.updateUser({
    id: user.id,
    account: user.account,
    name: user.name,
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
  avatarCropFile.value = null;
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

watch(needsBaseOnboard, async (need) => {
  if (!need) return;
  await nextTick();
  focusBaseOnboard();
});

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

      <div class="topbar-actions">
        <div class="user-chip">
          <button
            class="avatar-btn"
            type="button"
            title="修改头像"
            aria-label="修改头像"
            data-testid="avatar-open"
            @click="openAvatarPicker"
          >
            <img
              class="avatar-img"
              :src="currentAvatarUrl"
              alt=""
              width="28"
              height="28"
              draggable="false"
            />
          </button>
          <span class="user-name">{{ auth.state.user?.name }}</span>
          <button
            class="btn btn-ghost tiny"
            type="button"
            data-testid="change-password"
            @click="openChangePassword"
          >
            修改密码
          </button>
          <button class="btn btn-ghost tiny" type="button" @click="signOut">
            退出
          </button>
          <button
            class="btn btn-ghost tiny danger-text"
            type="button"
            data-testid="delete-account"
            @click="deleteAccount"
          >
            注销
          </button>
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
        <p v-if="loading" class="hint">加载中…</p>
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
        <p v-if="loading && hideWorkspaceSidebar" class="hint main-hint">加载中…</p>
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
                    placeholder="可选，每行一个账号，也可用逗号分隔"
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
          <div>
            <h1>{{ currentWorkspace.name }}</h1>
            <p class="sub">{{ bases.length }} 个智能表格</p>
          </div>
          <div class="main-head-actions" @click.stop>
            <button
              class="btn btn-ghost"
              type="button"
              data-testid="hub-members"
              :aria-pressed="membersSectionOpen"
              @click="membersSectionOpen = !membersSectionOpen"
            >
              成员
            </button>
            <div
              v-if="canEditCurrent && !needsBaseOnboard"
              class="create-wrap"
            >
              <button
                class="btn btn-primary create-btn"
                type="button"
                data-testid="create-base"
                @click="createMenuOpen = !createMenuOpen"
              >
                新建
                <span class="caret">{{ createMenuOpen ? '▴' : '▾' }}</span>
              </button>
              <Transition name="menu-fade">
                <div
                  v-if="createMenuOpen"
                  class="menu create-menu"
                  data-testid="hub-create-menu"
                >
                  <button type="button" @click="openCreateBaseForm">空白表格</button>
                  <button
                    type="button"
                    data-testid="hub-template"
                    @click="openTemplate"
                  >
                    从模板新建
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <MembersPanel
          v-if="currentWorkspaceId && membersSectionOpen && !basesLoading"
          class="members-inline"
          :workspace-id="currentWorkspaceId"
          embedded
          embedded-title="工作区成员"
        />

        <p v-if="basesLoading" class="hint main-hint">加载表格…</p>

        <div
          v-else-if="needsBaseOnboard"
          class="base-setup"
          data-testid="base-onboard"
        >
          <div class="base-setup-sheet">
            <section class="base-setup-create">
              <h2>创建第一张智能表格</h2>
              <form class="base-create-form" @submit.prevent="submitOnboardBase">
                <label class="base-create-field">
                  <span class="base-create-label">
                    表格名称<em class="required-star">*</em>
                  </span>
                  <input
                    ref="baseOnboardInput"
                    v-model="newBaseName"
                    class="base-create-input"
                    data-testid="base-onboard-name"
                    maxlength="100"
                    placeholder="例如：客户跟进"
                    autocomplete="off"
                    :disabled="creatingBase"
                  />
                </label>
                <label class="base-create-field">
                  <span class="base-create-label">描述</span>
                  <textarea
                    v-model="newBaseDescription"
                    class="base-create-textarea"
                    data-testid="base-onboard-description"
                    maxlength="500"
                    rows="2"
                    placeholder="一句话说明用途，方便同事辨认"
                    :disabled="creatingBase"
                  />
                </label>
                <div class="base-create-actions">
                  <button
                    class="btn btn-primary base-create-submit"
                    type="submit"
                    data-testid="base-onboard-submit"
                    :disabled="creatingBase"
                  >
                    {{ creatingBase ? '创建中…' : '创建并打开' }}
                  </button>
                  <button
                    class="base-template-link"
                    type="button"
                    data-testid="base-onboard-template"
                    :disabled="creatingBase"
                    @click="openTemplate"
                  >
                    或从模板新建
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>

        <div
          v-else-if="bases.length === 0"
          class="empty-panel"
          data-testid="base-list"
        >
          <div class="empty-icon">▦</div>
          <h2>暂无智能表格</h2>
          <p>当前角色无法新建，可联系工作区管理员。</p>
        </div>

        <div v-else class="base-list" data-testid="base-list">
          <article
            v-for="base in bases"
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
                  v-if="canEditCurrent && isOwnedBase(base)"
                  type="button"
                  data-testid="base-move-up"
                  :disabled="ownedIndex(base) <= 0"
                  @click="moveOrder(base, -1)"
                >
                  上移
                </button>
                <button
                  v-if="canEditCurrent && isOwnedBase(base)"
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
          <p class="dialog-desc">
            本地卡通头像（DiceBear Adventurer / CC BY 4.0），或上传图片自由裁剪后保存为方图。
          </p>
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
            <div class="avatar-actions-left">
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
                class="btn btn-ghost"
                type="button"
                :disabled="avatarPickerBusy"
                data-testid="avatar-upload"
                @click="pickAvatarUpload"
              >
                上传图片
              </button>
            </div>
            <div class="avatar-actions-right">
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
          </div>
        </template>
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

.avatar-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  flex: none;
  overflow: hidden;
  box-shadow: inset 0 -1px 0 rgba(31, 35, 41, 0.06);
}

.avatar-btn:hover {
  outline: 2px solid rgba(45, 140, 240, 0.35);
  outline-offset: 1px;
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
  width: min(440px, 92vw);
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.avatar-option {
  aspect-ratio: 1;
  padding: 4px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: #f5f6f7;
  cursor: pointer;
  overflow: hidden;
}

.avatar-option img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 10px;
  background: #fff;
}

.avatar-option:hover:not(:disabled) {
  border-color: rgba(45, 140, 240, 0.35);
}

.avatar-option.selected {
  border-color: var(--brand);
  background: #e8f3ff;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.16);
}

.avatar-option:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.avatar-actions {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.avatar-actions-left,
.avatar-actions-right {
  display: flex;
  gap: 8px;
}

.hidden-file {
  display: none;
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

.danger-text {
  color: #d4380d;
}

.danger-text:hover:not(:disabled) {
  color: #a8071a;
  background: #fff1f0;
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

.main-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.members-inline {
  margin: 16px 0 8px;
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
  animation: hub-menu-in 0.14s ease;
}

.menu.ws-menu-fixed {
  position: fixed;
  top: 0;
  right: auto;
  z-index: 2500;
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

.create-menu {
  left: 0;
  right: auto;
}

.empty-panel {
  margin-top: 28px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
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
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.empty-panel > .btn {
  align-self: flex-start;
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

  .crumb,
  .user-name {
    display: none;
  }
}
</style>
