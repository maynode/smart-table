<script setup lang="ts">
/**
 * 公开测试期顶栏提示（不可关闭）。构建时设 VITE_PREVIEW_BANNER=1 启用；正式环境改为 0 并重建。
 */
const enabled = (import.meta.env.VITE_PREVIEW_BANNER as string | undefined) === '1';
</script>

<template>
  <div
    v-if="enabled"
    class="preview-notice"
    role="status"
    data-testid="preview-notice-banner"
  >
    <div class="preview-notice-inner">
      <span class="preview-notice-badge">测试版</span>
      <p class="preview-notice-text">
        当前为公开测试环境，本环境全部数据将在测试结束后清空，请勿存放重要或需长期保留的内容。
      </p>
    </div>
  </div>
</template>
