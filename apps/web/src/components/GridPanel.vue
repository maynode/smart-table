<script setup lang="ts">
import { ref } from 'vue';
import CanvasGrid from './CanvasGrid.vue';
import { toast } from '../ui/toast';
import type { FieldDto, RecordDto } from '../api/types';
import type { GridStats } from '../grid-canvas/engine';

const props = defineProps<{
  sheetId: string;
  sheetName: string;
  fields: FieldDto[];
  records: RecordDto[];
  nextCursor: string | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  addRow: [];
  loadMore: [];
  commit: [payload: { record: RecordDto; field: FieldDto; value: string }];
  toggleField: [payload: { field: FieldDto; hidden: boolean }];
}>();

const settingsOpen = ref(false);

function comingSoon(label: string): void {
  toast(`${label}：完整视图能力将在后续任务开放`);
}

function handleViewport(stats: GridStats): void {
  if (!props.nextCursor || props.loading) return;
  if (stats.rows.end >= props.records.length - 5) {
    emit('loadMore');
  }
}
</script>

<template>
  <section class="grid-panel">
    <div class="grid-toolbar">
      <button class="btn btn-primary" data-testid="add-row" @click="emit('addRow')">
        + 添加一行
      </button>
      <button
        class="btn"
        data-testid="table-settings"
        @click="settingsOpen = !settingsOpen"
      >
        表格设置
      </button>
      <span class="toolbar-divider" />
      <button class="btn btn-ghost" @click="comingSoon('筛选')">筛选</button>
      <button class="btn btn-ghost" @click="comingSoon('分组')">分组</button>
      <button class="btn btn-ghost" @click="comingSoon('排序')">排序</button>
      <button class="btn btn-ghost" @click="comingSoon('行高')">行高</button>
      <button class="btn btn-ghost" @click="comingSoon('填色')">填色</button>
      <span class="toolbar-spacer" />
      <span class="muted">
        {{ records.length }}{{ nextCursor ? '+' : '' }} 条记录
      </span>
    </div>

    <div class="grid-body">
      <CanvasGrid
        :fields="fields"
        :records="records"
        @commit="(payload) => emit('commit', payload)"
        @viewport="handleViewport"
      />

      <aside v-if="settingsOpen" class="settings-panel">
        <header class="settings-header">
          <strong>表格设置</strong>
          <button class="icon-btn" @click="settingsOpen = false">×</button>
        </header>
        <p class="settings-subtitle">字段</p>
        <ul class="field-list">
          <li v-for="field in fields" :key="field.id">
            <span :class="{ 'field-hidden': field.hidden }">{{ field.name }}</span>
            <button
              class="icon-btn"
              :data-testid="`toggle-field-${field.id}`"
              :title="field.hidden ? '显示字段' : '隐藏字段'"
              @click="emit('toggleField', { field, hidden: !field.hidden })"
            >
              {{ field.hidden ? '隐' : '显' }}
            </button>
          </li>
        </ul>
        <p class="settings-hint">隐藏字段不显示在表格中，数据仍保留。</p>
      </aside>
    </div>

    <footer class="grid-footer">
      <button
        v-if="nextCursor"
        class="btn btn-ghost"
        :disabled="loading"
        @click="emit('loadMore')"
      >
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
      <span class="muted">{{ sheetName }} · {{ records.length }} 条已加载</span>
    </footer>
  </section>
</template>
