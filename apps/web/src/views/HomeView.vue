<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { auth } from '../stores/auth';
import { toast } from '../ui/toast';
import type { WorkspaceDto } from '../api/types';

const router = useRouter();
const workspaces = ref<WorkspaceDto[]>([]);
const newName = ref('');
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    workspaces.value = await endpoints.listWorkspaces();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '加载工作区失败');
  } finally {
    loading.value = false;
  }
}

async function createWorkspace(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  try {
    const workspace = await endpoints.createWorkspace(name);
    workspaces.value = [...workspaces.value, workspace];
    newName.value = '';
    toast('工作区已创建');
  } catch (error) {
    toast(error instanceof ApiError ? error.message : '创建工作区失败');
  }
}

function openWorkspace(id: string): void {
  void router.push(`/workspaces/${id}`);
}

function signOut(): void {
  auth.signOut();
  void router.push('/login');
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="brand-line">
        <span class="brand-mark">▦</span>
        <h1>智能表格</h1>
      </div>
      <div class="header-actions">
        <span class="muted">{{ auth.state.user?.name }}</span>
        <button class="btn btn-ghost" @click="signOut">退出</button>
      </div>
    </header>

    <main class="page-main">
      <section class="panel">
        <div class="panel-header">
          <h2>工作区</h2>
          <div class="inline-form">
            <input
              v-model="newName"
              data-testid="workspace-name"
              placeholder="新工作区名称"
              @keyup.enter="createWorkspace"
            />
            <button class="btn btn-primary" data-testid="create-workspace" @click="createWorkspace">
              创建工作区
            </button>
          </div>
        </div>

        <p v-if="loading" class="muted">加载中…</p>
        <div v-else class="card-grid">
          <button
            v-for="workspace in workspaces"
            :key="workspace.id"
            class="card"
            @click="openWorkspace(workspace.id)"
          >
            <span class="card-title">{{ workspace.name }}</span>
            <span class="card-sub">{{ workspace.role ?? '成员' }}</span>
          </button>
          <p v-if="workspaces.length === 0" class="muted">
            还没有工作区，先创建一个。
          </p>
        </div>
      </section>
    </main>
  </div>
</template>
