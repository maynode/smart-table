<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import type { TemplateDto, TemplateInstantiateResult } from '../api/types';

const props = defineProps<{
  workspaceId: string;
}>();
const emit = defineEmits<{
  close: [];
  created: [result: TemplateInstantiateResult];
}>();

const templates = ref<TemplateDto[]>([]);
const loading = ref(false);
const busyKey = ref('');
const search = ref('');
const expanded = ref<Record<string, boolean>>({});

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    templates.value = await endpoints.listTemplates();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function useTemplate(template: TemplateDto): Promise<void> {
  const name = (
    await promptDialog('新建 Base 名称', template.name, {
      confirmLabel: '创建',
    })
  )?.trim();
  if (!name) return;
  busyKey.value = template.key;
  try {
    const result = await endpoints.instantiateTemplate(template.key, {
      workspaceId: props.workspaceId,
      name,
    });
    toast(`已从「${template.name}」创建「${name}」`);
    emit('created', result);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busyKey.value = '';
  }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return templates.value;
  return templates.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q),
  );
});

const sections = computed(() => {
  const map = new Map<string, TemplateDto[]>();
  for (const item of filtered.value) {
    const key = item.category || '其他';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].map(([title, items]) => ({
    title,
    items,
    limit: expanded.value[title] ? items.length : Math.min(6, items.length),
  }));
});

function toggleSection(title: string): void {
  expanded.value = {
    ...expanded.value,
    [title]: !expanded.value[title],
  };
}

onMounted(load);
</script>

<template>
  <section class="template-panel" data-testid="template-panel">
    <header class="panel-header">
      <div>
        <strong>模板库</strong>
        <p class="panel-subtitle">从模板快速新建表格、表单与仪表盘。</p>
      </div>
      <button class="icon-btn" data-testid="template-close" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="toolbar">
      <input
        v-model="search"
        class="search-input"
        data-testid="template-search"
        placeholder="搜索模板"
      />
      <div class="quick-actions">
        <button class="quick-btn" type="button" disabled title="即将支持">
          导入 Excel 文件
        </button>
        <button class="quick-btn" type="button" disabled title="即将支持">
          我的模板
        </button>
      </div>
    </div>

    <div class="template-body">
      <section v-for="section in sections" :key="section.title" class="template-section">
        <header class="section-head">
          <h4>{{ section.title }}</h4>
          <button
            v-if="section.items.length > 6"
            class="expand-btn"
            type="button"
            @click="toggleSection(section.title)"
          >
            {{ expanded[section.title] ? '收起' : '展开更多' }}
          </button>
        </header>
        <div class="template-grid">
          <article
            v-for="template in section.items.slice(0, section.limit)"
            :key="template.key"
            class="template-card"
            data-testid="template-card"
            :data-key="template.key"
            @click="useTemplate(template)"
          >
            <div class="template-icon">{{ template.icon }}</div>
            <strong>{{ template.name }}</strong>
            <span class="template-category">{{ template.category }}</span>
            <p>{{ template.description }}</p>
            <small>
              {{
                template.sheets
                  .map((sheet) => `${sheet.name}（${sheet.fields} 字段）`)
                  .join(' · ')
              }}
            </small>
            <button
              class="btn btn-primary"
              data-testid="template-use"
              :disabled="busyKey === template.key"
              @click.stop="useTemplate(template)"
            >
              {{ busyKey === template.key ? '创建中…' : '使用模板' }}
            </button>
          </article>
        </div>
      </section>
      <p v-if="!filtered.length && !loading" class="empty-hint">暂无模板。</p>
    </div>
  </section>
</template>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  width: min(960px, 94vw);
  height: min(720px, 88vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-header strong {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
}
.panel-subtitle {
  margin: 6px 0 0;
  color: #8a9099;
  font-size: 12px;
  line-height: 1.5;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #eef0f3;
  background: #fafbfc;
}
.search-input {
  flex: 1;
  min-width: 180px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
}
.search-input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.quick-actions {
  display: flex;
  gap: 8px;
}
.quick-btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #f0f2f5;
  color: #98a2b3;
  font-size: 12px;
  cursor: not-allowed;
}
.template-body {
  flex: 1;
  overflow: auto;
  padding: 14px 20px 22px;
  background: #f5f6f8;
}
.template-section + .template-section {
  margin-top: 20px;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.section-head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #4e5969;
  letter-spacing: 0.02em;
}
.expand-btn {
  border: none;
  background: transparent;
  color: #1d6fdc;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.expand-btn:hover {
  color: #245bdb;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.template-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.template-card:hover {
  border-color: #91caff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}
.template-card:hover .btn-primary {
  background: #245bdb;
}
.template-card strong {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.template-card p {
  flex: 1;
  margin: 0;
  color: #4e5969;
  font-size: 12px;
  line-height: 1.6;
}
.template-card small {
  color: #8a9099;
  font-size: 11px;
  line-height: 1.45;
}
.template-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eef3ff;
  font-size: 22px;
  line-height: 1;
}
.template-category {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eef4ff;
  color: #2d6cdf;
  font-size: 11px;
  font-weight: 500;
}
.template-card .btn-primary {
  margin-top: 4px;
  align-self: stretch;
}
.empty-hint {
  margin: 40px 0;
  color: #8a9099;
  font-size: 13px;
  text-align: center;
}
@media (max-width: 800px) {
  .template-grid {
    grid-template-columns: 1fr;
  }
}
</style>
