<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppDialog from './components/AppDialog.vue';
import { toasts } from './ui/toast';
</script>

<template>
  <RouterView />
  <AppDialog />
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toasts" :key="item.id" class="toast">{{ item.text }}</div>
    </TransitionGroup>
  </div>
</template>
