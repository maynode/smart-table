<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type {
  CrossWorkspaceShareDto,
  WorkspaceDto,
} from '../api/types';

const props = defineProps<{
  workspaceId: string;
  baseId: string;
  sheetId?: string;
}>();

const emit = defineEmits<{ close: [] }>();

const shares = ref<CrossWorkspaceShareDto[]>([]);
const workspaces = ref<WorkspaceDto[]>([]);
const objectType = ref<'base' | 'sheet'>('base');
const targetWorkspaceId = ref('');
const role = ref<'view' | 'edit'>('view');
const loading = ref(false);

const candidates = computed(() =>
  workspaces.value.filter((workspace) => workspace.id !== props.workspaceId),
);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [list, workspaceList] = await Promise.all([
      endpoints.listShares(props.workspaceId, 'out'),
      endpoints.listWorkspaces(),
    ]);
    shares.value = list;
    workspaces.value = workspaceList;
    if (!targetWorkspaceId.value && candidates.value[0]) {
      targetWorkspaceId.value = candidates.value[0].id;
    }
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function createShare(): Promise<void> {
  if (!targetWorkspaceId.value) {
    toast('请选择目标工作区');
    return;
  }
  const objectId =
    objectType.value === 'base' ? props.baseId : props.sheetId ?? '';
  if (!objectId) {
    toast('请选择要共享的工作表');
    return;
  }
  try {
    await endpoints.createShare(props.workspaceId, {
      targetWorkspaceId: targetWorkspaceId.value,
      objectType: objectType.value,
      objectId,
      role: role.value,
    });
    await load();
    toast('已授权给目标工作区');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function revoke(share: CrossWorkspaceShareDto): Promise<void> {
  try {
    await endpoints.revokeShare(share.id);
    await load();
    toast('已撤销共享');
  } catch (error) {
    toast(messageOf(error));
  }
}

watch(objectType, () => {
  if (objectType.value === 'sheet' && !props.sheetId) {
    toast('当前没有选中的工作表');
  }
});

onMounted(load);
</script>

<template>
  <section class="share-panel" data-testid="share-panel">
    <header class="panel-header">
      <div>
        <strong>跨工作区共享</strong>
        <p class="panel-subtitle">
          授权后目标工作区成员按角色只读/可编辑访问，撤销立即失效。
        </p>
      </div>
      <button class="icon-btn" data-testid="share-close" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="share-body">
      <div class="share-form">
        <h4>新增授权</h4>
        <label>
          对象
          <select v-model="objectType" data-testid="share-type">
            <option value="base">整个 Base</option>
            <option value="sheet">单张工作表</option>
          </select>
        </label>
        <label>
          目标工作区
          <select v-model="targetWorkspaceId" data-testid="share-target">
            <option v-for="workspace in candidates" :key="workspace.id" :value="workspace.id">
              {{ workspace.name }}
            </option>
          </select>
        </label>
        <label>
          角色
          <select v-model="role" data-testid="share-role">
            <option value="view">只读（view）</option>
            <option value="edit">可编辑（edit）</option>
          </select>
        </label>
        <button class="btn btn-primary" data-testid="share-create" @click="createShare">
          授权
        </button>
        <p v-if="!candidates.length" class="empty-hint">
          还没有其他工作区可授权。
        </p>
      </div>

      <div class="share-list">
        <h4>已授出</h4>
        <div
          v-for="share in shares"
          :key="share.id"
          class="share-row"
          data-testid="share-row"
        >
          <div>
            <strong>{{ share.objectName }}</strong>
            <small>
              {{ share.objectType === 'base' ? 'Base' : '工作表' }} ·
              {{ share.role === 'edit' ? '可编辑' : '只读' }} →
              {{ share.targetWorkspaceName }}
            </small>
          </div>
          <button
            class="btn btn-ghost"
            data-testid="share-revoke"
            @click="revoke(share)"
          >
            撤销
          </button>
        </div>
        <p v-if="!shares.length && !loading" class="empty-hint">暂无授出记录。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.share-panel {
  display: flex;
  flex-direction: column;
  width: min(720px, 92vw);
  height: min(560px, 82vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-subtitle {
  margin: 4px 0 0;
  color: #8a9099;
  font-size: 12px;
}
.share-body {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
}
.share-form,
.share-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow: auto;
}
.share-form {
  border-right: 1px solid #e5e6eb;
  background: #fafbfc;
}
.share-form h4,
.share-list h4 {
  margin: 0 0 4px;
}
.share-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.share-form select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.share-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
}
.share-row small {
  display: block;
  margin-top: 3px;
  color: #8a9099;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
