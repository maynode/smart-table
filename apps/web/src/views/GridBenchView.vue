<script setup lang="ts">
import { onMounted, ref } from 'vue';
import CanvasGrid from '../components/CanvasGrid.vue';
import type { CellRender, GridStats } from '../grid-canvas/engine';
import type { FieldDto } from '../api/types';

const fields: FieldDto[] = [
  {
    id: 'col-serial',
    sheetId: 'bench',
    name: '序列号',
    type: 'text',
    options: null,
    order: 0,
    required: false,
    hidden: false,
  },
  {
    id: 'col-status',
    sheetId: 'bench',
    name: '状态',
    type: 'select',
    options: {
      choices: [
        { id: 'unclaimed', name: '未领', color: 'yellow' },
        { id: 'claimed', name: '已领', color: 'green' },
      ],
    },
    order: 1,
    required: false,
    hidden: false,
  },
  {
    id: 'col-phone',
    sheetId: 'bench',
    name: '手机号',
    type: 'phone',
    options: null,
    order: 2,
    required: false,
    hidden: false,
  },
];

const grid = ref<InstanceType<typeof CanvasGrid> | null>(null);
const stats = ref<GridStats | null>(null);

function provider(row: number, col: number): CellRender {
  if (col === 1) {
    return row % 3 === 0
      ? { text: '已领', pill: true, bg: '#e8fff3', color: '#0f9d58' }
      : { text: '未领', pill: true, bg: '#fff7e6', color: '#d46b08' };
  }
  if (col === 2) return { text: `138${String(row).padStart(8, '0')}` };
  return { text: `SN-${String(row).padStart(6, '0')}` };
}

onMounted(() => {
  const engine = grid.value?.getEngine();
  if (engine) window.__gridEngine = engine;
});

function onViewport(next: GridStats): void {
  stats.value = next;
}
</script>

<template>
  <div class="bench-page">
    <header class="bench-header">
      <strong>Canvas 性能基准</strong>
      <span class="muted">100,000 行 · 3 列</span>
      <span class="muted" data-testid="bench-stats">
        {{ stats ? `${stats.cellsDrawn} cells` : '' }}
      </span>
    </header>
    <CanvasGrid
      ref="grid"
      :fields="fields"
      :row-count="100000"
      :provider="provider"
      :editable="false"
      @viewport="onViewport"
    />
  </div>
</template>
