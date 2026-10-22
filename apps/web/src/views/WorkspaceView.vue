<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toast } from '../ui/toast';
import type { BaseDto, WorkspaceDto } from '../api/types';

const route = useRoute();
const router = useRouter();
const workspaceId = String(route.params.workspaceId);

const workspace = ref<WorkspaceDto | null>(null);
const bases = ref<BaseDto[]>([]);
const newName = ref('');
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [detail, list] = await Promise.all([
      endpoints.getWorkspace(workspaceId),
      endpoints.listBases(workspaceId),
    ]);
    workspace.value = detail;
    bases.value = list;
    // 旧工作区若为空：补一套「序列号领取」演示（码库+收集表单+自动化）
    if (list.length === 0) {
      try {
        const demo = await endpoints.instantiateTemplate('serial-claim', {
          workspaceId,
        });
        bases.value = await endpoints.listBases(workspaceId);
        toast('已创建默认「序列号领取」演示，可扫码填表');
        if (demo.shareUrl) {
          // eslint-disable-next-line no-console
          console.info('[serial-claim] shareUrl', demo.shareUrl);
        }
        if (demo.baseId) {
          void router.push(`/workspaces/${workspaceId}/bases/${demo.baseId}`);
        }
      } catch (error) {
        toast(error instanceof ApiError ? error.message : '创建演示失败');
      }
    }
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

async function createBase(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  try {
    const base = await endpoints.createBase(workspaceId, name);
    bases.value = [...bases.value, base];
    newName.value = '';
    toast('Base 已创建');
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '创建失败');
  }
}

function openBase(baseId: string): void {
  void router.push(`/workspaces/${workspaceId}/bases/${baseId}`);
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="brand-line">
        <button class="btn btn-ghost" @click="router.push('/')">← 工作区</button>
        <h1>{{ workspace?.name ?? '工作区' }}</h1>
      </div>
      <span class="muted">Base 列表</span>
    </header>

    <main class="page-main">
      <section class="panel">
        <div class="panel-header">
          <h2>Base</h2>
          <div class="inline-form">
            <input
              v-model="newName"
              data-testid="base-name"
              placeholder="新 Base 名称"
              @keyup.enter="createBase"
            />
            <button class="btn btn-primary" data-testid="create-base" @click="createBase">
              创建 Base
            </button>
          </div>
        </div>

        <p v-if="loading" class="muted">加载中…</p>
        <div v-else class="card-grid">
          <button
            v-for="base in bases"
            :key="base.id"
            class="card"
            @click="openBase(base.id)"
          >
            <span class="card-title">{{ base.name }}</span>
            <span class="card-sub">打开</span>
          </button>
          <p v-if="bases.length === 0" class="muted">还没有 Base。</p>
        </div>
      </section>
    </main>
  </div>
</template>
