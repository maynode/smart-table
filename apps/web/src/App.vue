<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppDialog from './components/AppDialog.vue';
import { toasts } from './ui/toast';
</script>

<template>
  <RouterView />
  <AppDialog />
  <div class="toast-host">
    <div v-for="item in toasts" :key="item.id" class="toast">{{ item.text }}</div>
  </div>
</template>
