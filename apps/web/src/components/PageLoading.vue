<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    /** inline = 列表内一行；block = 主内容区居中 */
    variant?: 'block' | 'inline';
  }>(),
  { label: '加载中…', variant: 'block' },
);
</script>

<template>
  <div
    class="page-loading"
    :class="variant === 'inline' ? 'page-loading-inline' : 'page-loading-block'"
    role="status"
    aria-live="polite"
    data-testid="page-loading"
  >
    <span class="page-loading-spinner" aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>
