<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type { TemplateDto, TemplateInstantiateResult } from '../api/types';

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{
  close: [];
  created: [result: TemplateInstantiateResult];
}>();

const templates = ref<TemplateDto[]>([]);
const loading = ref(false);
const busyKey = ref('');

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
  busyKey.value = template.key;
  try {
    const result = await endpoints.instantiateTemplate(template.key, {
      workspaceId: props.workspaceId,
    });
    toast(`已从「${template.name}」创建 Base`);
    emit('created', result);
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busyKey.value = '';
  }
}

onMounted(load);
</script>

<template>
  <section class="template-panel" data-testid="template-panel">
    <header class="panel-header">
      <div>
        <strong>模板库</strong>
        <p class="panel-subtitle">一键生成 Base、工作表、字段、示例数据与自动化。</p>
      </div>
      <button class="icon-btn" data-testid="template-close" @click="emit('close')">
        ×
      </button>
    </header>
    <div class="template-grid">
      <article
        v-for="template in templates"
        :key="template.key"
        class="template-card"
        data-testid="template-card"
        :data-key="template.key"
      >
        <div class="template-icon">{{ template.icon }}</div>
        <strong>{{ template.name }}</strong>
        <span class="template-category">{{ template.category }}</span>
        <p>{{ template.description }}</p>
        <small>
          {{ template.sheets.map((sheet) => `${sheet.name}（${sheet.fields} 字段）`).join(' · ') }}
        </small>
        <button
          class="btn btn-primary"
          data-testid="template-use"
          :disabled="busyKey === template.key"
          @click="useTemplate(template)"
        >
          {{ busyKey === template.key ? '创建中…' : '使用模板' }}
        </button>
      </article>
      <p v-if="!templates.length && !loading" class="empty-hint">暂无模板。</p>
    </div>
  </section>
</template>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  width: min(900px, 94vw);
  height: min(640px, 86vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.panel-subtitle {
  margin: 4px 0 0;
  color: #8a9099;
  font-size: 12px;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 18px;
  overflow: auto;
}
.template-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid #e5e6eb;
  border-radius: 10px;
  background: #fafbfc;
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
}
.template-icon {
  font-size: 30px;
}
.template-category {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2d6cdf;
  font-size: 11px;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
