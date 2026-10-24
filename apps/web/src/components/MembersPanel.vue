<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { validateAccount } from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { MemberDto } from '../api/types';
import { confirmDialog } from '../ui/dialog';

type AssignableRole = 'admin' | 'editor' | 'viewer';

const ROLE_OPTIONS: Array<{
  value: AssignableRole;
  label: string;
  hint: string;
}> = [
  { value: 'editor', label: '可编辑', hint: '可新建和编辑表格与记录' },
  { value: 'viewer', label: '只读', hint: '只能查看，不能改内容' },
  { value: 'admin', label: '管理员', hint: '可管理成员与工作区设置' },
];

const props = withDefaults(
  defineProps<{
    workspaceId: string;
    /** 嵌入页面时不显示关闭按钮，并改为贴合主区样式 */
    embedded?: boolean;
    /** 嵌入时的区块标题；默认「工作区成员」 */
    embeddedTitle?: string;
    /** 嵌入时的一句说明 */
    embeddedHint?: string;
  }>(),
  {
    embedded: false,
    embeddedTitle: '工作区成员',
    embeddedHint: '',
  },
);
const emit = defineEmits<{
  close: [];
  changed: [members: MemberDto[]];
}>();

const members = ref<MemberDto[]>([]);
const batchAccounts = ref('');
const role = ref<AssignableRole>('editor');
const loading = ref(false);
const inviting = ref(false);
const error = ref('');
const inviteSummary = ref('');
const openMenu = ref<'invite' | string | null>(null);
const menuPos = ref<{ top: number; left: number } | null>(null);

const menuMember = computed(() =>
  openMenu.value && openMenu.value !== 'invite'
    ? members.value.find((item) => memberKey(item) === openMenu.value) ?? null
    : null,
);

function memberKey(member: MemberDto): string {
  return member.registered
    ? member.userId
    : (member.inviteId ?? member.account);
}

function messageOf(value: unknown): string {
  return value instanceof ApiError ? value.message : '网络错误，请稍后重试';
}

function roleLabel(value: string): string {
  return (
    {
      owner: '所有者',
      admin: '管理员',
      editor: '可编辑',
      viewer: '只读',
    }[value] ?? value
  );
}

function closeMenu(): void {
  openMenu.value = null;
  menuPos.value = null;
}

function placeMenu(anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 220;
  const menuHeight = 168;
  const gap = 6;
  let left = rect.left;
  let top = rect.bottom + gap;
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, rect.right - menuWidth);
  }
  if (top + menuHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuHeight - gap);
  }
  menuPos.value = { top, left };
}

function toggleMenu(id: 'invite' | string, event: Event): void {
  event.stopPropagation();
  if (openMenu.value === id) {
    closeMenu();
    return;
  }
  openMenu.value = id;
  placeMenu(event.currentTarget as HTMLElement);
}

function pickInviteRole(next: AssignableRole): void {
  role.value = next;
  closeMenu();
}

async function pickMemberRole(
  member: MemberDto,
  next: AssignableRole,
): Promise<void> {
  closeMenu();
  await changeRole(member, next);
}

function onDocumentClick(): void {
  closeMenu();
}

function onWindowChange(): void {
  closeMenu();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    members.value = (await endpoints.listMembers(props.workspaceId)).map(
      (item) => ({
        ...item,
        registered: item.registered !== false,
      }),
    );
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    loading.value = false;
  }
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

async function invite(): Promise<void> {
  const targets = parseInviteAccounts(batchAccounts.value);
  if (targets.length === 0) {
    error.value = '请输入成员账号';
    inviteSummary.value = '';
    return;
  }

  const invalid = targets
    .map((item) => ({ item, message: validateAccount(item) }))
    .filter((row) => row.message);
  if (invalid.length > 0) {
    error.value = `账号格式有误：${invalid
      .slice(0, 3)
      .map((row) => row.item)
      .join('、')}${invalid.length > 3 ? '…' : ''}`;
    inviteSummary.value = '';
    return;
  }

  inviting.value = true;
  error.value = '';
  inviteSummary.value = '';
  const added: MemberDto[] = [];
  const failed: string[] = [];
  try {
    for (const target of targets) {
      try {
        const created = await endpoints.inviteMember(
          props.workspaceId,
          target,
          role.value,
        );
        added.push(created);
      } catch (cause) {
        failed.push(`${target}（${messageOf(cause)}）`);
      }
    }
    if (added.length > 0) {
      const keys = new Set(members.value.map(memberKey));
      for (const item of added) {
        const key = memberKey(item);
        if (keys.has(key)) continue;
        keys.add(key);
        members.value = [...members.value, item];
      }
      emit('changed', [...members.value]);
      batchAccounts.value = '';
    }
    if (failed.length > 0) {
      error.value =
        targets.length === 1
          ? failed[0]!.replace(/^[^（]+（(.+)）$/, '$1')
          : `${failed.length} 个失败：${failed.slice(0, 2).join('；')}${
              failed.length > 2 ? '…' : ''
            }`;
    }
    if (added.length > 0) {
      inviteSummary.value = `已邀请 ${added.length} 人`;
    }
  } finally {
    inviting.value = false;
  }
}

async function changeRole(
  member: MemberDto,
  next: AssignableRole,
): Promise<void> {
  if (next === member.role) return;
  const targetId = member.registered
    ? member.userId
    : (member.inviteId ?? '');
  if (!targetId) return;
  try {
    const updated = await endpoints.updateMemberRole(
      props.workspaceId,
      targetId,
      next,
    );
    const key = memberKey(member);
    members.value = members.value.map((item) =>
      memberKey(item) === key ? updated : item,
    );
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
    await load();
  }
}

async function remove(member: MemberDto): Promise<void> {
  const label = member.registered ? member.name : member.account;
  const ok = await confirmDialog(
    member.registered
      ? `将「${label}」移出工作区？`
      : `取消邀请「${label}」？`,
    {
      title: member.registered ? '移除成员' : '取消邀请',
      confirmLabel: member.registered ? '移除' : '取消邀请',
    },
  );
  if (!ok) return;
  const targetId = member.registered
    ? member.userId
    : (member.inviteId ?? '');
  if (!targetId) return;
  try {
    await endpoints.removeMember(props.workspaceId, targetId);
    const key = memberKey(member);
    members.value = members.value.filter((item) => memberKey(item) !== key);
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('resize', onWindowChange);
  window.addEventListener('scroll', onWindowChange, true);
  void load();
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  window.removeEventListener('resize', onWindowChange);
  window.removeEventListener('scroll', onWindowChange, true);
});
</script>

<template>
  <section
    class="members-panel"
    :class="{ modal: !embedded, embedded }"
    data-testid="members-panel"
  >
    <header class="members-head">
      <div>
        <h3>{{ embedded ? embeddedTitle : '工作区成员' }}</h3>
        <p v-if="embedded && embeddedHint">{{ embeddedHint }}</p>
      </div>
      <div class="members-head-actions">
        <button
          v-if="!embedded"
          class="icon-btn"
          aria-label="关闭"
          type="button"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <form class="invite-form invite-form-batch" @submit.prevent="invite">
      <textarea
        v-model="batchAccounts"
        class="invite-batch-input"
        data-testid="invite-account"
        rows="4"
        placeholder="每行一个账号，也可用逗号分隔"
        :disabled="inviting"
      />
      <div class="invite-form-tools">
        <div class="role-select" @click.stop>
          <button
            type="button"
            class="role-trigger"
            data-testid="invite-role"
            :aria-expanded="openMenu === 'invite'"
            :disabled="inviting"
            @click="toggleMenu('invite', $event)"
          >
            <span>{{ roleLabel(role) }}</span>
            <span class="role-caret" :class="{ open: openMenu === 'invite' }" />
          </button>
        </div>
        <button
          class="btn"
          :class="embedded ? 'btn-ghost invite-btn' : 'btn-primary'"
          type="submit"
          data-testid="invite-submit"
          :disabled="inviting"
        >
          {{ inviting ? '邀请中…' : '邀请' }}
        </button>
      </div>
    </form>
    <p v-if="inviteSummary" class="invite-summary" data-testid="invite-summary">
      {{ inviteSummary }}
    </p>
    <p v-if="error" class="invite-error" data-testid="members-error">{{ error }}</p>

    <ul class="member-list">
      <li
        v-for="member in members"
        :key="memberKey(member)"
        data-testid="member-row"
        :data-registered="member.registered ? '1' : '0'"
      >
        <span class="avatar" :class="{ pending: !member.registered }">
          {{ (member.name || member.account).slice(0, 1) }}
        </span>
        <span class="member-main">
          <strong>
            {{ member.registered ? member.name : member.account }}
            <span
              v-if="!member.registered"
              class="pending-tag"
              data-testid="member-pending-tag"
            >
              未注册
            </span>
          </strong>
          <small v-if="member.registered && member.account !== member.name">
            {{ member.account }}
          </small>
        </span>
        <div v-if="member.role !== 'owner'" class="role-select compact" @click.stop>
          <button
            type="button"
            class="role-trigger"
            :aria-label="`${member.account} 的角色`"
            :aria-expanded="openMenu === memberKey(member)"
            @click="toggleMenu(memberKey(member), $event)"
          >
            <span>{{ roleLabel(member.role) }}</span>
            <span
              class="role-caret"
              :class="{ open: openMenu === memberKey(member) }"
            />
          </button>
        </div>
        <span v-else class="role-badge">{{ roleLabel(member.role) }}</span>
        <button
          v-if="member.role !== 'owner'"
          class="icon-btn danger"
          :title="member.registered ? '移出工作区' : '取消邀请'"
          @click="remove(member)"
        >
          ×
        </button>
      </li>
      <li v-if="loading" class="muted-row">加载中…</li>
      <li v-else-if="members.length === 0 && !error" class="muted-row">
        暂无成员。
      </li>
    </ul>

    <Teleport to="body">
      <ul
        v-if="openMenu && menuPos"
        class="role-menu-fixed"
        data-testid="invite-role-menu"
        :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
        @click.stop
      >
        <li v-for="opt in ROLE_OPTIONS" :key="opt.value">
          <button
            type="button"
            class="role-option"
            :class="{
              active:
                openMenu === 'invite'
                  ? opt.value === role
                  : opt.value === menuMember?.role,
            }"
            @click="
              openMenu === 'invite'
                ? pickInviteRole(opt.value)
                : menuMember && pickMemberRole(menuMember, opt.value)
            "
          >
            <strong>{{ opt.label }}</strong>
            <small>{{ opt.hint }}</small>
          </button>
        </li>
      </ul>
    </Teleport>
  </section>
</template>

<style scoped>
.members-panel {
  width: min(620px, 92vw);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 22px 16px;
  border-radius: 14px;
  background: #fff;
}

.members-panel.modal {
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
}

.members-panel.embedded {
  width: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 20px 24px 22px;
  border: 0;
  border-top: 1px solid #eef0f3;
  border-radius: 0;
  box-shadow: none;
  background: #fafbfc;
}
.members-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex: none;
  padding-bottom: 4px;
}
.members-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.members-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.members-panel.embedded .members-head h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #646a73;
}
.members-head p {
  margin: 0;
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
  line-height: 1.5;
}
.members-panel.embedded .members-head p {
  margin: 0 0 14px;
}
.members-panel.embedded .invite-btn {
  height: 34px;
  border: 1px solid #d0d5dd;
  background: #fff;
}
.invite-form {
  display: flex;
  gap: 8px;
  flex: none;
  margin: 16px 0 4px;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 10px;
  border: 1px solid var(--border-light, #eef0f3);
}
.invite-form.invite-form-batch {
  flex-direction: column;
  align-items: stretch;
}
.members-panel.embedded .invite-form {
  margin: 0 0 4px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.invite-batch-input {
  width: 100%;
  min-height: 88px;
  padding: 8px 10px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
}
.invite-batch-input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.invite-form-tools {
  display: flex;
  gap: 8px;
  flex: none;
  align-items: center;
  justify-content: flex-end;
}
.invite-error {
  margin: 8px 0 0;
  flex: none;
  color: #d92d20;
  font-size: 12px;
}
.invite-summary {
  margin: 8px 0 0;
  flex: none;
  color: #389e0d;
  font-size: 12px;
}

.role-select {
  position: relative;
  flex: none;
  width: 108px;
}
.role-select.compact {
  width: 96px;
}
.role-trigger {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  color: var(--text, #1f2329);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.role-select.compact .role-trigger {
  height: 30px;
  font-size: 12px;
  padding: 0 8px;
}
.role-trigger:hover {
  border-color: #b7bec7;
}
.role-trigger:focus,
.role-trigger[aria-expanded='true'] {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.role-caret {
  width: 8px;
  height: 8px;
  flex: none;
  border-right: 1.5px solid #8f959e;
  border-bottom: 1.5px solid #8f959e;
  transform: rotate(45deg) translateY(-2px);
  transition: transform 0.14s ease;
}
.role-caret.open {
  transform: rotate(-135deg) translateY(-1px);
}

.member-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.members-panel.embedded .member-list {
  margin-top: 10px;
  overflow: visible;
}
.members-panel.embedded .member-list li {
  min-height: 48px;
  padding-left: 0;
  padding-right: 0;
}
.member-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 6px 8px;
  border-radius: 8px;
  transition: background 0.12s ease;
}
.member-list li:hover {
  background: #f7f8fa;
}
.muted-row {
  color: var(--text-tertiary, #8f959e);
  font-size: 13px;
  min-height: auto !important;
  padding: 12px 8px !important;
}
.pending-tag {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 6px;
  height: 18px;
  border-radius: 4px;
  background: #fff7e8;
  color: #d48806;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
}
.avatar {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f3ff;
  color: #1d6fdc;
  font-weight: 600;
  font-size: 13px;
  flex: none;
}
.avatar.pending {
  background: #fff7e8;
  color: #d48806;
}
.member-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.member-main strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-main small {
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-badge {
  padding: 3px 10px;
  border-radius: 6px;
  background: #eef3ff;
  color: #245bdb;
  font-size: 12px;
  font-weight: 500;
}
.icon-btn.danger {
  color: #d4380d;
  opacity: 0.7;
}
.member-list li:hover .icon-btn.danger {
  opacity: 1;
}
</style>

<style>
.role-menu-fixed {
  position: fixed;
  z-index: 3200;
  width: 220px;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(31, 35, 41, 0.14);
}
.role-menu-fixed .role-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.role-menu-fixed .role-option strong {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.role-menu-fixed .role-option small {
  font-size: 12px;
  color: #8f959e;
  line-height: 1.35;
}
.role-menu-fixed .role-option:hover {
  background: #f5f6f8;
}
.role-menu-fixed .role-option.active {
  background: #e8f3ff;
}
.role-menu-fixed .role-option.active strong {
  color: #1a6dcc;
}
</style>
