<script setup lang="ts">
import type { FolderNodeDto } from '../api/types';

defineProps<{
  node: FolderNodeDto;
  depth: number;
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="folder-node">
    <button
      class="folder-row"
      :class="{ active: selectedId === node.id }"
      :style="{ paddingLeft: `${10 + depth * 18}px` }"
      data-testid="folder-row"
      @click="emit('select', node.id)"
    >
      <span>📁 {{ node.name }}</span>
      <small>{{ node.bases.length }} 个 Base</small>
    </button>
    <div
      v-for="base in node.bases"
      :key="base.id"
      class="folder-base"
      :style="{ paddingLeft: `${30 + depth * 18}px` }"
    >
      ▦ {{ base.name }}
    </div>
    <FolderNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :depth="depth + 1"
      :selected-id="selectedId"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.folder-row {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.folder-row.active {
  background: #eef4ff;
  border-color: #cfe0ff;
}
.folder-row small {
  color: #8a9099;
}
.folder-base {
  padding-top: 5px;
  padding-bottom: 5px;
  color: #4e5969;
  font-size: 12px;
}
</style>
