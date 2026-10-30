<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppDialog from './components/AppDialog.vue';
import FeedbackFab from './components/FeedbackFab.vue';
import ImpersonationBanner from './components/ImpersonationBanner.vue';
import LoginModal from './components/LoginModal.vue';
import PreviewNoticeBanner from './components/PreviewNoticeBanner.vue';
import { toasts } from './ui/toast';
</script>

<template>
  <div class="app-shell">
    <PreviewNoticeBanner />
    <ImpersonationBanner />
    <div class="app-shell-main">
      <RouterView />
    </div>
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
