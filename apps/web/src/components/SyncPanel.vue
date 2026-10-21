<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { toast } from '../ui/toast';
import type {
  DataSyncDto,
  DataSyncRunDto,
  FieldDto,
} from '../api/types';

const props = defineProps<{ sheetId: string; fields: FieldDto[] }>();
const emit = defineEmits<{ close: [] }>();

const syncs = ref<DataSyncDto[]>([]);
const name = ref('外部数据同步');
const sourceType = ref<'http' | 'file'>('http');
const url = ref('');
const fileId = ref('');
const fileName = ref('');
const mapping = ref<Array<{ key: string; fieldId: string }>>([
  { key: '', fieldId: props.fields[0]?.id ?? '' },
]);
const matchFieldId = ref('');
const mode = ref<'upsert' | 'replace'>('upsert');
const cron = ref('');
const runs = ref<Record<string, DataSyncRunDto[]>>({});
const busy = ref(false);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

async function load(): Promise<void> {
  try {
    syncs.value = await endpoints.listDataSyncs(props.sheetId);
  } catch (error) {
    toast(messageOf(error));
  }
}

function addMapping(): void {
  mapping.value.push({ key: '', fieldId: props.fields[0]?.id ?? '' });
}

async function pickFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const uploaded = await endpoints.uploadSyncFile(props.sheetId, file);
    fileId.value = uploaded.id;
    fileName.value = uploaded.filename;
    toast('文件已上传');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function create(): Promise<void> {
  const mappingObject: Record<string, string> = {};
  for (const item of mapping.value) {
    if (item.key.trim() && item.fieldId) mappingObject[item.key.trim()] = item.fieldId;
  }
  if (!Object.keys(mappingObject).length) {
    toast('请至少配置一个字段映射');
    return;
  }
  busy.value = true;
  try {
    await endpoints.createDataSync(props.sheetId, {
      name: name.value,
      sourceType: sourceType.value,
      config:
        sourceType.value === 'http'
          ? { url: url.value }
          : { fileId: fileId.value },
      mapping: mappingObject,
      matchFieldId: matchFieldId.value || undefined,
      mode: mode.value,
      cron: cron.value || undefined,
    });
    await load();
    toast('同步任务已创建');
  } catch (error) {
    toast(messageOf(error));
  } finally {
    busy.value = false;
  }
}

async function run(sync: DataSyncDto): Promise<void> {
  try {
    const result = await endpoints.runDataSync(sync.id);
    runs.value[sync.id] = await endpoints.listDataSyncRuns(sync.id);
    await load();
    toast(
      result.status === 'success'
        ? `同步完成：读取 ${result.rowsRead} 行，写入 ${result.rowsWritten} 行`
        : `同步失败：${result.error}`,
    );
  } catch (error) {
    toast(messageOf(error));
  }
}

async function showRuns(sync: DataSyncDto): Promise<void> {
  try {
    runs.value[sync.id] = await endpoints.listDataSyncRuns(sync.id);
  } catch (error) {
    toast(messageOf(error));
  }
}

async function remove(sync: DataSyncDto): Promise<void> {
  try {
    await endpoints.deleteDataSync(sync.id);
    await load();
  } catch (error) {
    toast(messageOf(error));
  }
}

onMounted(load);
</script>

<template>
  <section class="sync-panel" data-testid="sync-panel">
    <header class="sync-header">
      <div>
        <strong>同步数据</strong>
        <p>从 HTTP JSON 或 CSV/Excel 定时覆盖/更新工作表。</p>
      </div>
      <button class="icon-btn" data-testid="sync-close" @click="emit('close')">×</button>
    </header>

    <div class="sync-body">
      <div class="sync-form">
        <h4>新建同步</h4>
        <label>
          名称
          <input v-model="name" data-testid="sync-name" />
        </label>
        <label>
          数据源
          <select v-model="sourceType" data-testid="sync-source">
            <option value="http">HTTP JSON</option>
            <option value="file">CSV / Excel</option>
          </select>
        </label>
        <label v-if="sourceType === 'http'">
          URL
          <input
            v-model="url"
            placeholder="https://example.com/data.json"
            data-testid="sync-url"
          />
        </label>
        <label v-else>
          文件
          <input type="file" accept=".csv,.xlsx" data-testid="sync-file" @change="pickFile" />
          <small v-if="fileName">{{ fileName }}</small>
        </label>

        <div class="mapping-title">
          <strong>字段映射</strong>
          <button class="btn btn-ghost" data-testid="sync-add-mapping" @click="addMapping">
            + 映射
          </button>
        </div>
        <div
          v-for="(item, index) in mapping"
          :key="index"
          class="mapping-row"
        >
          <input
            v-model="item.key"
            placeholder="外部列名/JSON key"
            data-testid="sync-key"
          />
          <select v-model="item.fieldId" data-testid="sync-field">
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
        </div>

        <label>
          匹配字段（upsert 用）
          <select v-model="matchFieldId" data-testid="sync-match">
            <option value="">不匹配，全部新增</option>
            <option v-for="field in fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option>
          </select>
        </label>
        <label>
          写入模式
          <select v-model="mode" data-testid="sync-mode">
            <option value="upsert">Upsert</option>
            <option value="replace">覆盖全部</option>
          </select>
        </label>
        <label>
          Cron（可选）
          <input v-model="cron" placeholder="0 * * * *" data-testid="sync-cron" />
        </label>
        <button
          class="btn btn-primary"
          :disabled="busy"
          data-testid="sync-create"
          @click="create"
        >
          创建同步
        </button>
      </div>

      <div class="sync-list">
        <h4>同步任务</h4>
        <div
          v-for="sync in syncs"
          :key="sync.id"
          class="sync-row"
          data-testid="sync-row"
        >
          <div class="sync-meta">
            <strong>{{ sync.name }}</strong>
            <small>
              {{ sync.sourceType.toUpperCase() }} · {{ sync.mode }}
              <template v-if="sync.cron"> · {{ sync.cron }}</template>
              <template v-if="sync.lastRunAt">
                · 上次 {{ new Date(sync.lastRunAt).toLocaleString() }}
              </template>
            </small>
          </div>
          <div class="sync-actions">
            <button class="btn btn-ghost" @click="showRuns(sync)">运行记录</button>
            <button class="btn btn-primary" data-testid="sync-run" @click="run(sync)">
              立即同步
            </button>
            <button class="btn btn-danger" @click="remove(sync)">删除</button>
          </div>
          <div v-if="runs[sync.id]" class="runs">
            <div
              v-for="item in runs[sync.id]"
              :key="item.id"
              class="run"
              data-testid="sync-run-row"
            >
              <span :class="['status', item.status]">{{ item.status }}</span>
              <span>{{ item.trigger }}</span>
              <span>{{ item.rowsRead }} → {{ item.rowsWritten }} 行</span>
              <small v-if="item.error">{{ item.error }}</small>
            </div>
          </div>
        </div>
        <p v-if="!syncs.length" class="empty-hint">暂无同步任务。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sync-panel {
  display: flex;
  flex-direction: column;
  width: min(900px, 95vw);
  height: min(640px, 86vh);
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.sync-header {
  display: flex;
  justify-content: space-between;
  padding: 15px 20px;
  border-bottom: 1px solid #e5e6eb;
}
.sync-header p {
  margin: 4px 0 0;
  color: #8a9099;
  font-size: 12px;
}
.sync-body {
  display: grid;
  grid-template-columns: 310px 1fr;
  flex: 1;
  min-height: 0;
}
.sync-form,
.sync-list {
  padding: 16px;
  overflow: auto;
}
.sync-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
  border-right: 1px solid #eef0f3;
  background: #fafbfc;
}
.sync-form h4,
.sync-list h4 {
  margin: 0;
}
.sync-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #646a73;
}
.sync-form input,
.sync-form select,
.mapping-row input,
.mapping-row select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
}
.mapping-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.mapping-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.sync-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  margin-bottom: 8px;
}
.sync-meta small {
  display: block;
  color: #8a9099;
  font-size: 11px;
  margin-top: 4px;
}
.sync-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.runs {
  flex-basis: 100%;
  border-top: 1px dashed #eef0f3;
  padding-top: 6px;
}
.run {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  padding: 2px 0;
}
.status.success {
  color: #14a44d;
}
.status.failed {
  color: #d92d20;
}
.status.running {
  color: #b7791f;
}
.empty-hint {
  color: #8a9099;
  font-size: 12px;
}
</style>
