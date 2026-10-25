<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import type { TemplateDto, TemplateInstantiateResult } from '../api/types';

const props = withDefaults(
  defineProps<{
    workspaceId: string;
    /** workspace：新建整表；base：向当前表格追加对象 */
    mode?: 'workspace' | 'base';
    baseId?: string;
  }>(),
  { mode: 'workspace' },
);
const emit = defineEmits<{
  close: [];
  created: [result: TemplateInstantiateResult];
}>();

const templates = ref<TemplateDto[]>([]);
const loading = ref(false);
const busyKey = ref('');
const search = ref('');
const expanded = ref<Record<string, boolean>>({});
const kindFilter = ref<string>('all');

const isBaseMode = computed(() => props.mode === 'base');

const kindTabs = [
  { id: 'all', label: '全部' },
  { id: 'sheet', label: '工作表' },
  { id: 'dashboard', label: '仪表盘' },
  { id: 'form', label: '收集表单' },
  { id: 'report', label: '分析报告' },
];

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    templates.value = await endpoints.listTemplates(
      isBaseMode.value ? 'base' : 'workspace',
    );
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function useTemplate(template: TemplateDto): Promise<void> {
  const promptTitle = isBaseMode.value
    ? `新建${template.category || '对象'}名称`
    : '新建 Base 名称';
  const name = (
    await promptDialog(promptTitle, template.name, {
      confirmLabel: '创建',
    })
  )?.trim();
  if (!name) return;
  busyKey.value = template.key;
  try {
    const result = await endpoints.instantiateTemplate(template.key, {
      workspaceId: props.workspaceId,
      baseId: isBaseMode.value ? props.baseId : undefined,
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
  return templates.value.filter((item) => {
    if (
      isBaseMode.value &&
      kindFilter.value !== 'all' &&
      item.kind !== kindFilter.value
    ) {
      return false;
    }
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });
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

function metaLine(template: TemplateDto): string {
  if (!template.sheets?.length) {
    if (template.kind === 'dashboard') return '空白仪表盘';
    if (template.kind === 'report') return 'AI 分析报告';
    return template.category;
  }
  return template.sheets
    .map((sheet) => `${sheet.name}（${sheet.fields} 字段）`)
    .join(' · ');
}

onMounted(load);
</script>

<template>
  <section class="template-panel" data-testid="template-panel">
    <header class="panel-header">
      <div>
        <strong>{{ isBaseMode ? '对象模板' : '模板库' }}</strong>
        <p class="panel-subtitle">
          {{
            isBaseMode
              ? '从模板新建工作表、仪表盘、收集表单或分析报告。'
              : '从模板快速新建整套智能表格。'
          }}
        </p>
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
      <!-- 未就绪能力不展示占位入口（导入请用壳层「导入」；我的模板未上线） -->
    </div>

    <div v-if="isBaseMode" class="kind-tabs" role="tablist">
      <button
        v-for="tab in kindTabs"
        :key="tab.id"
        type="button"
        class="kind-tab"
        :class="{ active: kindFilter === tab.id }"
        @click="kindFilter = tab.id"
      >
        {{ tab.label }}
      </button>
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
            <small>{{ metaLine(template) }}</small>
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
  border: 1px solid #d0d3d9;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
}
.search-input:focus {
  outline: none;
  border-color: #2d8cf0;
  box-shadow: 0 0 0 2px rgba(45, 140, 240, 0.12);
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
  background: #fff;
  color: #8a9099;
  font-size: 12px;
  cursor: not-allowed;
}
.kind-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px 0;
  border-bottom: 1px solid #eef0f3;
  background: #fff;
}
.kind-tab {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #646a73;
  font-size: 13px;
  cursor: pointer;
}
.kind-tab.active {
  color: #1a6dcc;
  border-bottom-color: #2d8cf0;
  font-weight: 600;
}
.template-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 24px;
}
.template-section + .template-section {
  margin-top: 20px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #646a73;
}
.expand-btn {
  border: 0;
  background: transparent;
  color: #1a6dcc;
  font-size: 12px;
  cursor: pointer;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.template-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.template-card:hover {
  border-color: #91caff;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.08);
}
.template-icon {
  font-size: 22px;
  line-height: 1;
}
.template-card strong {
  font-size: 14px;
  color: #1f2329;
}
.template-category {
  font-size: 11px;
  color: #8a9099;
}
.template-card p {
  margin: 0;
  font-size: 12px;
  color: #646a73;
  line-height: 1.45;
  min-height: 34px;
}
.template-card small {
  font-size: 11px;
  color: #8a9099;
}
.template-card .btn {
  margin-top: 6px;
  width: 100%;
  justify-content: center;
}
.empty-hint {
  margin: 48px 0;
  text-align: center;
  color: #8a9099;
  font-size: 13px;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  color: #8f959e;
}
</style>
