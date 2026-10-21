<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { PublicViewData } from '../api/types';

const route = useRoute();
const token = String(route.params.token);
const data = ref<PublicViewData | null>(null);
const password = ref('');
const needPassword = ref(false);
const error = ref('');
const loading = ref(false);

function displayValue(field: PublicViewData['fields'][number], value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (field.type === 'select' || field.type === 'multiSelect') {
    const options = field.options as
      | { choices?: Array<{ id: string; name: string }> }
      | undefined;
    const choices = options?.choices ?? [];
    if (Array.isArray(value)) {
      return value
        .map((item) => choices.find((choice) => choice.id === item)?.name ?? item)
        .join('、');
    }
    return choices.find((choice) => choice.id === value)?.name ?? String(value);
  }
  return String(value);
}

async function load(withPassword?: string): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    data.value = await endpoints.getPublicView(token, withPassword);
    needPassword.value = false;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      needPassword.value = true;
    } else {
      error.value =
        caught instanceof ApiError ? caught.message : '公开视图加载失败';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <div class="public-view-page">
    <header class="public-header">
      <strong>只读数据视图</strong>
      <span v-if="data">共 {{ data.records.length }} 行 · 不可编辑</span>
    </header>

    <div v-if="needPassword" class="password-card">
      <h2>{{ data?.name ?? '受保护的公开视图' }}</h2>
      <p>该视图需要访问密码。</p>
      <input
        v-model="password"
        type="password"
        placeholder="请输入访问密码"
        data-testid="public-view-password"
        @keyup.enter="load(password)"
      />
      <button class="btn btn-primary" data-testid="public-view-submit" @click="load(password)">
        查看数据
      </button>
    </div>

    <div v-else-if="error" class="password-card">
      <h2>无法访问</h2>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="data">
      <div class="view-title">
        <h1>{{ data.name }}</h1>
        <small>{{ data.sheet.name }} · 只读</small>
      </div>
      <div class="table-wrap">
        <table data-testid="public-view-table">
          <thead>
            <tr>
              <th v-for="field in data.fields" :key="field.id">{{ field.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in data.records" :key="record.id">
              <td v-for="field in data.fields" :key="field.id">
                {{ displayValue(field, record.cells[field.id]) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!data.records.length" class="empty">暂无数据。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.public-view-page {
  min-height: 100vh;
  background: #f5f7fa;
  color: #1f2329;
}
.public-header {
  display: flex;
  justify-content: space-between;
  padding: 14px 22px;
  background: #fff;
  border-bottom: 1px solid #e5e6eb;
  font-size: 13px;
  color: #646a73;
}
.password-card {
  width: min(420px, 90vw);
  margin: 80px auto;
  padding: 26px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.1);
  text-align: center;
}
.password-card input {
  width: 100%;
  height: 36px;
  margin: 14px 0;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  box-sizing: border-box;
}
.view-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  max-width: 1100px;
  margin: 24px auto 10px;
  padding: 0 18px;
}
.view-title h1 {
  margin: 0;
  font-size: 20px;
}
.view-title small {
  color: #8a9099;
}
.table-wrap {
  max-width: 1100px;
  margin: 0 auto 40px;
  padding: 0 18px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
  font-size: 13px;
}
th,
td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f1f3;
  text-align: left;
  white-space: nowrap;
}
th {
  background: #fafbfc;
  color: #646a73;
  font-weight: 500;
}
.empty {
  padding: 40px;
  color: #8a9099;
  text-align: center;
}
</style>
