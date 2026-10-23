<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { validateAccount } from 'shared';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { MemberDto } from '../api/types';
import { confirmDialog } from '../ui/dialog';

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{
  close: [];
  changed: [members: MemberDto[]];
}>();

const members = ref<MemberDto[]>([]);
const account = ref('');
const role = ref<'editor' | 'viewer' | 'admin'>('editor');
const loading = ref(false);
const inviting = ref(false);
const error = ref('');

function messageOf(value: unknown): string {
  return value instanceof ApiError ? value.message : '网络错误，请稍后重试';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    members.value = await endpoints.listMembers(props.workspaceId);
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    loading.value = false;
  }
}

async function invite(): Promise<void> {
  const target = account.value.trim().toLowerCase();
  if (!target) {
    error.value = '请输入成员账号';
    return;
  }
  const accountError = validateAccount(target);
  if (accountError) {
    error.value = accountError;
    return;
  }
  inviting.value = true;
  error.value = '';
  try {
    const created = await endpoints.inviteMember(
      props.workspaceId,
      target,
      role.value,
    );
    members.value = [...members.value, created];
    account.value = '';
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
  } finally {
    inviting.value = false;
  }
}

async function changeRole(
  member: MemberDto,
  next: 'owner' | 'admin' | 'editor' | 'viewer',
): Promise<void> {
  if (next === member.role) return;
  try {
    const updated = await endpoints.updateMemberRole(
      props.workspaceId,
      member.userId,
      next,
    );
    members.value = members.value.map((item) =>
      item.userId === updated.userId ? updated : item,
    );
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
    await load();
  }
}

async function remove(member: MemberDto): Promise<void> {
  const ok = await confirmDialog(`将「${member.name}」移出工作区？`, {
    title: '移除成员',
    confirmLabel: '移除',
  });
  if (!ok) return;
  try {
    await endpoints.removeMember(props.workspaceId, member.userId);
    members.value = members.value.filter(
      (item) => item.userId !== member.userId,
    );
    emit('changed', [...members.value]);
  } catch (cause) {
    error.value = messageOf(cause);
  }
}

function onRoleChange(member: MemberDto, event: Event): void {
  const value = (event.target as HTMLSelectElement).value as
    | 'admin'
    | 'editor'
    | 'viewer';
  void changeRole(member, value);
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

onMounted(load);
</script>

<template>
  <section class="members-panel modal" data-testid="members-panel">
    <header class="members-head">
      <div>
        <h3>工作区成员</h3>
        <p>成员会自动出现在人员字段的可选列表中。</p>
      </div>
      <button class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
    </header>

    <form class="invite-form" @submit.prevent="invite">
      <input
        v-model="account"
        placeholder="输入已注册成员的账号"
        data-testid="invite-account"
      />
      <select v-model="role" data-testid="invite-role">
        <option value="editor">可编辑</option>
        <option value="viewer">只读</option>
        <option value="admin">管理员</option>
      </select>
      <button
        class="btn btn-primary"
        type="submit"
        data-testid="invite-submit"
        :disabled="inviting"
      >
        {{ inviting ? '邀请中…' : '邀请' }}
      </button>
    </form>
    <p v-if="error" class="invite-error" data-testid="members-error">{{ error }}</p>

    <ul class="member-list">
      <li v-for="member in members" :key="member.userId" data-testid="member-row">
        <span class="avatar">{{ member.name.slice(0, 1) }}</span>
        <span class="member-main">
          <strong>{{ member.name }}</strong>
          <small>{{ member.account }}</small>
        </span>
        <select
          v-if="member.role !== 'owner'"
          :value="member.role"
          :aria-label="`${member.name} 的角色`"
          @change="onRoleChange(member, $event)"
        >
          <option value="admin">管理员</option>
          <option value="editor">可编辑</option>
          <option value="viewer">只读</option>
        </select>
        <span v-else class="role-badge">{{ roleLabel(member.role) }}</span>
        <button
          v-if="member.role !== 'owner'"
          class="icon-btn danger"
          title="移出工作区"
          @click="remove(member)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="members.length === 0 && !error" class="muted">暂无成员。</p>
  </section>
</template>

<style scoped>
.members-panel {
  width: min(620px, 92vw);
  max-height: 80vh;
  overflow: auto;
  padding: 20px 22px 22px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
}
.members-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 4px;
}
.members-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.members-head p {
  margin: 0;
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
  line-height: 1.5;
}
.invite-form {
  display: flex;
  gap: 8px;
  margin: 16px 0 4px;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 10px;
  border: 1px solid var(--border-light, #eef0f3);
}
.invite-form input {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
  background: #fff;
  font-size: 13px;
}
.invite-form input:focus,
.invite-form select:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.invite-form select {
  height: 34px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
  background: #fff;
  font-size: 13px;
  padding: 0 8px;
}
.invite-error {
  margin: 8px 0 0;
  color: #d92d20;
  font-size: 12px;
}
.member-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
}
.member-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 6px 8px;
  border-radius: 8px;
  border-bottom: 1px solid transparent;
  transition: background 0.12s ease;
}
.member-list li:hover {
  background: #f7f8fa;
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
.member-list select {
  height: 30px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  padding: 0 6px;
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
.muted {
  margin: 12px 4px 0;
  color: var(--text-tertiary, #8f959e);
  font-size: 13px;
}
</style>
