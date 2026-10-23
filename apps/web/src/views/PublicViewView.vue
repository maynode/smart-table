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
  background: linear-gradient(180deg, #eef2f7 0%, #f5f7fa 180px);
  color: #1f2329;
}
.public-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 22px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid #e5e6eb;
  font-size: 13px;
  color: #646a73;
  backdrop-filter: blur(8px);
}
.public-header strong {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.password-card {
  width: min(420px, 90vw);
  margin: 88px auto;
  padding: 28px 26px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1);
  text-align: center;
  border: 1px solid #eef0f3;
}
.password-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}
.password-card p {
  margin: 0;
  color: #8a9099;
  font-size: 13px;
  line-height: 1.5;
}
.password-card input {
  width: 100%;
  height: 38px;
  margin: 16px 0 12px;
  padding: 0 12px;
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  box-sizing: border-box;
  font-size: 14px;
}
.password-card input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.view-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  max-width: 1100px;
  margin: 28px auto 12px;
  padding: 0 18px;
}
.view-title h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.view-title small {
  color: #8a9099;
  font-size: 12px;
}
.table-wrap {
  max-width: 1100px;
  margin: 0 auto 48px;
  padding: 0 18px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(15, 23, 42, 0.06);
  font-size: 13px;
  border: 1px solid #eef0f3;
}
th,
td {
  padding: 11px 14px;
  border-bottom: 1px solid #f0f1f3;
  text-align: left;
  white-space: nowrap;
}
th {
  background: #f7f8fa;
  color: #646a73;
  font-weight: 600;
  font-size: 12px;
}
tbody tr:hover td {
  background: #fafbfc;
}
tbody tr:last-child td {
  border-bottom: none;
}
.empty {
  padding: 48px 24px;
  color: #8a9099;
  text-align: center;
  font-size: 13px;
}
</style>
