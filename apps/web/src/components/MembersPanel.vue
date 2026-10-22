<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { MemberDto } from '../api/types';

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{
  close: [];
  changed: [members: MemberDto[]];
}>();

const members = ref<MemberDto[]>([]);
const email = ref('');
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
  const target = email.value.trim().toLowerCase();
  if (!target) {
    error.value = '请输入成员邮箱';
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) {
    error.value = '邮箱格式不正确';
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
    email.value = '';
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
  if (!window.confirm(`将「${member.name}」移出工作区？`)) return;
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
        v-model="email"
        type="email"
        placeholder="输入已注册成员的邮箱"
        data-testid="invite-email"
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
          <small>{{ member.email }}</small>
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
  padding: 20px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
}
.members-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.members-head h3 {
  margin: 0 0 4px;
}
.members-head p {
  margin: 0;
  color: #8f959e;
  font-size: 12px;
}
.invite-form {
  display: flex;
  gap: 8px;
  margin: 16px 0 4px;
}
.invite-form input {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
}
.invite-form select {
  height: 34px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
}
.invite-error {
  margin: 6px 0 0;
  color: #d92d20;
  font-size: 12px;
}
.member-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.member-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 4px;
  border-bottom: 1px solid #f0f1f3;
}
.avatar {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f3ff;
  color: #1d6fdc;
  font-weight: 600;
  flex: none;
}
.member-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.member-main small {
  color: #8f959e;
}
.member-list select {
  height: 30px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.role-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: #f2f3f5;
  color: #646a73;
  font-size: 12px;
}
.icon-btn.danger {
  color: #d4380d;
}
</style>
