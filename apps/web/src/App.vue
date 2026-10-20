<script setup lang="ts">
import { RouterView } from 'vue-router';
import { toasts } from './ui/toast';
</script>

<template>
  <RouterView />
  <div class="toast-host">
    <div v-for="item in toasts" :key="item.id" class="toast">{{ item.text }}</div>
  </div>
</template>
