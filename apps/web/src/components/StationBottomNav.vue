<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { shouldShowStationNav } from '../composables/viewport';
import { auth } from '../stores/auth';

const route = useRoute();

const visible = computed(() =>
  shouldShowStationNav({
    authed: Boolean(auth.state.token),
    path: route.path,
  }),
);

function itemActive(paths: string[]): boolean {
  return paths.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}
</script>

<template>
  <nav
    v-if="visible"
    class="station-bottom-nav"
    data-testid="station-bottom-nav"
    aria-label="主导航"
  >
    <RouterLink
      to="/"
      class="station-nav-item"
      :class="{ active: itemActive(['/']) && route.path === '/' }"
      data-testid="station-nav-home"
    >
      <span class="station-nav-label">首页</span>
    </RouterLink>
    <RouterLink
      to="/notifications"
      class="station-nav-item"
      :class="{ active: itemActive(['/notifications']) }"
      data-testid="station-nav-notifications"
    >
      <span class="station-nav-label">通知</span>
    </RouterLink>
    <RouterLink
      to="/me"
      class="station-nav-item"
      :class="{ active: itemActive(['/me']) }"
      data-testid="station-nav-me"
    >
      <span class="station-nav-label">我的</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.station-nav-label {
  font-size: 12px;
}
</style>
