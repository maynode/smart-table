<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppDialog from './components/AppDialog.vue';
import FeedbackFab from './components/FeedbackFab.vue';
import ImpersonationBanner from './components/ImpersonationBanner.vue';
import LoginModal from './components/LoginModal.vue';
import PreviewNoticeBanner from './components/PreviewNoticeBanner.vue';
import StationBottomNav from './components/StationBottomNav.vue';
import { shouldShowStationNav } from './composables/viewport';
import { auth } from './stores/auth';
import { toasts } from './ui/toast';

const route = useRoute();
const showStationNav = computed(() =>
  shouldShowStationNav({
    authed: Boolean(auth.state.token),
    path: route.path,
  }),
);
</script>

<template>
  <div class="app-shell" :class="{ 'has-station-nav': showStationNav }">
    <PreviewNoticeBanner />
    <ImpersonationBanner />
    <div class="app-shell-main">
      <RouterView />
    </div>
    <StationBottomNav />
  </div>
  <FeedbackFab />
  <LoginModal />
  <AppDialog />
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toasts" :key="item.id" class="toast">{{ item.text }}</div>
    </TransitionGroup>
  </div>
</template>
