<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FolderNode from './FolderNode.vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type { FolderNodeDto, FolderTreeDto } from '../api/types';

const props = defineProps<{ workspaceId: string; baseId: string }>();
const emit = defineEmits<{ close: [] }>();

const tree = ref<FolderTreeDto>({ folders: [], unfiled: [] });
const selectedId = ref<string | null>(null);
const name = ref('新文件夹');
const loading = ref(false);

const selected = computed(() => {
  function find(nodes: FolderNodeDto[]): FolderNodeDto | null {
    for (const node of nodes) {
      if (node.id === selectedId.value) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  }
  return find(tree.value.folders);
});

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    tree.value = await endpoints.listFolderTree(props.workspaceId);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function createFolder(parent: 'root' | 'child'): Promise<void> {
  if (!name.value.trim()) {
    toast('请输入文件夹名称');
    return;
  }
  try {
    const created = await endpoints.createFolder(props.workspaceId, {
      name: name.value.trim(),
      parentId: parent === 'child' ? selectedId.value : null,
    });
    selectedId.value = created.id;
    await load();
    toast('文件夹已创建');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function moveBase(): Promise<void> {
  if (!selectedId.value) {
    toast('请先选择目标文件夹');
    return;
  }
  try {
    await endpoints.moveBaseToFolder(props.baseId, selectedId.value);
    await load();
    toast('Base 已移入文件夹');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function removeFolder(): Promise<void> {
  if (!selectedId.value) return;
  try {
    await endpoints.deleteFolder(selectedId.value);
    selectedId.value = null;
    await load();
    toast('文件夹已删除，内容已上移');
  } catch (error) {
    toast(messageOf(error));
  }
}

onMounted(load);
</script>

<template>
  <section class="folder-panel" data-testid="folder-panel">
    <header class="panel-header">
      <div>
        <strong>文件夹</strong>
        <p class="panel-subtitle">嵌套组织工作区内的 Base，最多 8 层。</p>
      </div>
      <button class="icon-btn" data-testid="folder-close" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="folder-body">
      <div class="folder-tree">
        <FolderNode
          v-for="node in tree.folders"
          :key="node.id"
          :node="node"
          :depth="0"
          :selected-id="selectedId"
          @select="selectedId = $event"
        />
        <p v-if="!tree.folders.length && !loading" class="empty-hint">
          还没有文件夹。
        </p>
        <div v-if="tree.unfiled.length" class="unfiled">
          <strong>未归档</strong>
          <div v-for="base in tree.unfiled" :key="base.id" class="folder-base">
            ▦ {{ base.name }}
          </div>
        </div>
      </div>

      <div class="folder-actions">
        <label>
          文件夹名称
          <input v-model="name" data-testid="folder-create-name" />
        </label>
        <button class="btn" data-testid="folder-create-root" @click="createFolder('root')">
          新建根文件夹
        </button>
        <button
          class="btn"
          :disabled="!selectedId"
          data-testid="folder-create-child"
          @click="createFolder('child')"
        >
          新建子文件夹
        </button>
        <button
          class="btn btn-primary"
          :disabled="!selectedId"
          data-testid="folder-move-base"
          @click="moveBase"
        >
          移入当前 Base
        </button>
        <button
          class="btn btn-danger"
          :disabled="!selectedId"
          data-testid="folder-delete"
          @click="removeFolder"
        >
          删除选中文件夹
        </button>
        <p v-if="selected" class="selected-hint">
          已选：{{ selected.name }} · {{ selected.bases.length }} 个 Base
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.folder-panel {
  display: flex;
  flex-direction: column;
  width: min(760px, 92vw);
  height: min(620px, 84vh);
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
.folder-body {
  display: grid;
  grid-template-columns: 1fr 260px;
  flex: 1;
  min-height: 0;
}
.folder-tree {
  padding: 12px;
  overflow: auto;
  background: #fafbfc;
  border-right: 1px solid #e5e6eb;
}
.folder-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.folder-actions label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #646a73;
}
.folder-actions input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
}
.unfiled {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #d0d3d9;
}
.folder-base {
  padding-top: 5px;
  color: #4e5969;
  font-size: 12px;
}
.selected-hint {
  font-size: 12px;
  color: #2d6cdf;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
