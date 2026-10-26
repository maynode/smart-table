<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { LiveEvent } from 'shared';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { liveBus } from '../sync/live-bus';
import { copyText } from '../ui/clipboard';
import { rewritePublicUrl } from '../ui/public-url';
import { toast } from '../ui/toast';
import type {
  PublicViewDto,
  PublicViewScopeOption,
  PublicViewScopeOptions,
} from '../api/types';

const props = withDefaults(
  defineProps<{ sheetId: string; editable?: boolean }>(),
  { editable: true },
);
const emit = defineEmits<{ close: [] }>();

const views = ref<PublicViewDto[]>([]);
const scope = ref<PublicViewScopeOptions | null>(null);
const name = ref('只读数据视图');
const password = ref('');
const clearPassword = ref(false);
const expiresAt = ref('');
const loading = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const selectedSheetIds = ref<string[]>([]);
const selectedFormSheetIds = ref<string[]>([]);
const selectedDashboardIds = ref<string[]>([]);
const selectedReportIds = ref<string[]>([]);

const isEditing = computed(() => Boolean(editingId.value));

const selectableCount = computed(() => {
  if (!scope.value) return 0;
  return (
    scope.value.sheets.filter((i) => i.hasData).length +
    scope.value.formSheets.filter((i) => i.hasData).length +
    scope.value.dashboards.filter((i) => i.hasData).length +
    scope.value.analysisReports.filter((i) => i.hasData).length
  );
});

const selectedCount = computed(
  () =>
    selectedSheetIds.value.length +
    selectedFormSheetIds.value.length +
    selectedDashboardIds.value.length +
    selectedReportIds.value.length,
);

const allSelectableSelected = computed(
  () =>
    selectableCount.value > 0 && selectedCount.value === selectableCount.value,
);

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

function idsWithData(items: PublicViewScopeOption[]): string[] {
  return items.filter((item) => item.hasData).map((item) => item.id);
}

function syncDefaultSelection(): void {
  if (!scope.value) return;
  selectedSheetIds.value = idsWithData(scope.value.sheets);
  selectedFormSheetIds.value = idsWithData(scope.value.formSheets);
  selectedDashboardIds.value = idsWithData(scope.value.dashboards);
  selectedReportIds.value = idsWithData(scope.value.analysisReports);
}

type ScopeKind = 'sheet' | 'form' | 'dashboard' | 'report';

function listOf(kind: ScopeKind) {
  switch (kind) {
    case 'sheet':
      return selectedSheetIds;
    case 'form':
      return selectedFormSheetIds;
    case 'dashboard':
      return selectedDashboardIds;
    case 'report':
      return selectedReportIds;
  }
}

function toggleIn(kind: ScopeKind, id: string, enabled: boolean): void {
  if (!props.editable || !enabled) return;
  const list = listOf(kind);
  if (list.value.includes(id)) {
    if (selectedCount.value <= 1) {
      toast('至少选择一项有数据的内容');
      return;
    }
    list.value = list.value.filter((item) => item !== id);
    return;
  }
  list.value = [...list.value, id];
}

function toggleAll(): void {
  if (!props.editable || !scope.value) return;
  if (allSelectableSelected.value) {
    // 保留第一项有数据内容，避免空选
    const first =
      idsWithData(scope.value.sheets)[0] ??
      idsWithData(scope.value.formSheets)[0] ??
      idsWithData(scope.value.dashboards)[0] ??
      idsWithData(scope.value.analysisReports)[0];
    selectedSheetIds.value = first &&
      scope.value.sheets.some((s) => s.id === first)
      ? [first]
      : [];
    selectedFormSheetIds.value =
      first && scope.value.formSheets.some((s) => s.id === first)
        ? [first]
        : [];
    selectedDashboardIds.value =
      first && scope.value.dashboards.some((s) => s.id === first)
        ? [first]
        : [];
    selectedReportIds.value =
      first && scope.value.analysisReports.some((s) => s.id === first)
        ? [first]
        : [];
    return;
  }
  syncDefaultSelection();
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [list, options] = await Promise.all([
      endpoints.listPublicViews(props.sheetId),
      endpoints.publicViewScopeOptions(props.sheetId),
    ]);
    views.value = list;
    scope.value = options;
    if (editingId.value) {
      const current = list.find((item) => item.id === editingId.value);
      if (!current) resetForm();
    } else {
      syncDefaultSelection();
    }
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  editingId.value = null;
  name.value = '只读数据视图';
  password.value = '';
  clearPassword.value = false;
  expiresAt.value = '';
  syncDefaultSelection();
}

function beginEdit(view: PublicViewDto): void {
  editingId.value = view.id;
  name.value = view.name;
  password.value = '';
  clearPassword.value = false;
  expiresAt.value = view.expiresAt
    ? new Date(view.expiresAt).toISOString().slice(0, 10)
    : '';
  selectedSheetIds.value = [...(view.sheetIds ?? [])];
  selectedFormSheetIds.value = [...(view.formSheetIds ?? [])];
  selectedDashboardIds.value = [...(view.dashboardIds ?? [])];
  selectedReportIds.value = [...(view.analysisReportIds ?? [])];
  if (!selectedCount.value) syncDefaultSelection();
}

function cancelEdit(): void {
  resetForm();
}

async function save(): Promise<void> {
  if (!props.editable) {
    toast('当前为只读权限，无法创建公开视图');
    return;
  }
  if (!selectedCount.value) {
    toast('请至少选择一项有数据的公开内容');
    return;
  }
  if (saving.value) return;
  saving.value = true;
  try {
    const expires = expiresAt.value
      ? new Date(`${expiresAt.value}T23:59:59`).toISOString()
      : null;
    const scopeBody = {
      sheetIds: selectedSheetIds.value,
      formSheetIds: selectedFormSheetIds.value,
      dashboardIds: selectedDashboardIds.value,
      analysisReportIds: selectedReportIds.value,
    };
    if (editingId.value) {
      await endpoints.updatePublicView(editingId.value, {
        name: name.value,
        expiresAt: expires,
        ...(clearPassword.value
          ? { clearPassword: true }
          : password.value
            ? { password: password.value }
            : {}),
        ...scopeBody,
      });
      toast('公开链接已更新');
    } else {
      await endpoints.createPublicView(props.sheetId, {
        name: name.value,
        password: password.value || undefined,
        expiresAt: expires,
        ...scopeBody,
      });
      toast('公开只读链接已创建');
    }
    resetForm();
    await load();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    saving.value = false;
  }
}

async function revoke(view: PublicViewDto): Promise<void> {
  if (!props.editable) {
    toast('当前为只读权限，无法撤销');
    return;
  }
  try {
    await endpoints.revokePublicView(view.id);
    if (editingId.value === view.id) resetForm();
    await load();
    toast('公开链接已撤销');
  } catch (error) {
    toast(messageOf(error));
  }
}

async function copy(view: PublicViewDto): Promise<void> {
  const url = rewritePublicUrl(view.url) || view.url;
  const ok = await copyText(url);
  toast(ok ? '链接已复制' : url);
}

function scopeLabel(view: PublicViewDto): string {
  const parts: string[] = [];
  const sheets = view.sheetIds?.length ?? 0;
  const forms = view.formSheetIds?.length ?? 0;
  const dashboards = view.dashboardIds?.length ?? 0;
  const reports = view.analysisReportIds?.length ?? 0;
  if (sheets) parts.push(`${sheets} 张工作表`);
  if (forms) parts.push(`${forms} 个表单结果`);
  if (dashboards) parts.push(`${dashboards} 个仪表盘`);
  if (reports) parts.push(`${reports} 份报告`);
  return parts.length ? parts.join(' · ') : '宿主工作表';
}

watch(
  () => props.sheetId,
  () => {
    void load();
  },
);

const liveUnsubs: Array<() => void> = [];

function onPublicViewLive(event: LiveEvent): void {
  if (event.meta?.sheetId === props.sheetId) {
    void load();
    return;
  }
  if (views.value.some((view) => view.id === event.entityId)) {
    void load();
  }
}

onMounted(() => {
  void load();
  liveUnsubs.push(liveBus.on('public_view.*', onPublicViewLive));
});

onBeforeUnmount(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
});
</script>

<template>
  <section class="public-panel" data-testid="public-view-panel">
    <header class="panel-header">
      <div>
        <strong>公开只读视图</strong>
        <p class="panel-subtitle">
          勾选有数据的工作表、表单收集结果、仪表盘与分析报告；可设密码与有效期。
        </p>
      </div>
      <button
        class="icon-btn"
        data-testid="public-view-close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div class="public-body">
      <aside class="scope-pane" data-testid="public-view-scope">
        <div class="scope-head">
          <h4>公开内容范围</h4>
          <button
            v-if="editable"
            type="button"
            class="nl-link"
            data-testid="public-view-scope-toggle-all"
            :disabled="!selectableCount"
            @click="toggleAll"
          >
            {{ allSelectableSelected ? '取消全选' : '全选有数据' }}
          </button>
        </div>
        <p class="scope-hint">
          仅可勾选已有数据的项（已选 {{ selectedCount }} /
          {{ selectableCount }}）。
        </p>

        <template v-if="scope">
          <div class="scope-group">
            <div class="scope-group-title">工作表</div>
            <label
              v-for="item in scope.sheets"
              :key="item.id"
              class="scope-row"
              :class="{ disabled: !item.hasData || !editable }"
              :data-testid="`public-view-scope-sheet-${item.id}`"
            >
              <input
                type="checkbox"
                :checked="selectedSheetIds.includes(item.id)"
                :disabled="!item.hasData || !editable"
                @change="toggleIn('sheet', item.id, item.hasData)"
              />
              <span :title="item.name">{{ item.name }}</span>
              <em>{{ item.hasData ? `${item.recordCount} 行` : '无数据' }}</em>
            </label>
            <p v-if="!scope.sheets.length" class="group-empty">暂无工作表</p>
          </div>

          <div class="scope-group">
            <div class="scope-group-title">表单收集结果</div>
            <label
              v-for="item in scope.formSheets"
              :key="item.id"
              class="scope-row"
              :class="{ disabled: !item.hasData || !editable }"
              :data-testid="`public-view-scope-form-${item.id}`"
            >
              <input
                type="checkbox"
                :checked="selectedFormSheetIds.includes(item.id)"
                :disabled="!item.hasData || !editable"
                @change="toggleIn('form', item.id, item.hasData)"
              />
              <span :title="item.name">{{ item.name }}</span>
              <em>{{ item.hasData ? `${item.recordCount} 行` : '无数据' }}</em>
            </label>
            <p v-if="!scope.formSheets.length" class="group-empty">
              暂无收集表单
            </p>
          </div>

          <div class="scope-group">
            <div class="scope-group-title">仪表盘</div>
            <label
              v-for="item in scope.dashboards"
              :key="item.id"
              class="scope-row"
              :class="{ disabled: !item.hasData || !editable }"
              :data-testid="`public-view-scope-dashboard-${item.id}`"
            >
              <input
                type="checkbox"
                :checked="selectedDashboardIds.includes(item.id)"
                :disabled="!item.hasData || !editable"
                @change="toggleIn('dashboard', item.id, item.hasData)"
              />
              <span :title="item.name">{{ item.name }}</span>
              <em>{{
                item.hasData ? `${item.widgetCount} 组件` : '无数据'
              }}</em>
            </label>
            <p v-if="!scope.dashboards.length" class="group-empty">
              暂无仪表盘
            </p>
          </div>

          <div class="scope-group">
            <div class="scope-group-title">分析报告</div>
            <label
              v-for="item in scope.analysisReports"
              :key="item.id"
              class="scope-row"
              :class="{ disabled: !item.hasData || !editable }"
              :data-testid="`public-view-scope-report-${item.id}`"
            >
              <input
                type="checkbox"
                :checked="selectedReportIds.includes(item.id)"
                :disabled="!item.hasData || !editable"
                @change="toggleIn('report', item.id, item.hasData)"
              />
              <span :title="item.name">{{ item.name }}</span>
              <em>{{ item.hasData ? '已生成' : '未就绪' }}</em>
            </label>
            <p v-if="!scope.analysisReports.length" class="group-empty">
              暂无分析报告
            </p>
          </div>
        </template>
        <p v-else-if="!loading" class="empty-hint">无法加载可选范围。</p>
      </aside>

      <div class="public-main">
        <div class="public-form">
          <h4>{{ isEditing ? '编辑链接' : '新建链接' }}</h4>
          <fieldset :disabled="!editable" class="public-form-fields">
          <label>
            名称
            <input v-model="name" data-testid="public-view-name" />
          </label>
          <label>
            访问密码（可选）
            <input
              v-model="password"
              type="password"
              :placeholder="
                isEditing
                  ? '留空则保持原密码；填写则更换'
                  : '至少 4 位'
              "
              data-testid="public-view-password"
              @input="clearPassword = false"
            />
          </label>
          <label
            v-if="
              isEditing &&
              views.find((v) => v.id === editingId)?.passwordRequired
            "
            class="scope-row password-clear"
          >
            <input
              v-model="clearPassword"
              type="checkbox"
              data-testid="public-view-clear-password"
              @change="
                () => {
                  if (clearPassword) password = '';
                }
              "
            />
            <span>清除访问密码</span>
          </label>
          <label>
            有效期（可选）
            <input
              v-model="expiresAt"
              type="date"
              data-testid="public-view-expiry"
            />
          </label>
          </fieldset>
          <div v-if="editable" class="form-actions">
            <button
              class="btn btn-primary"
              data-testid="public-view-create"
              :disabled="!selectedCount || saving"
              @click="save"
            >
              {{ isEditing ? '保存修改' : '创建公开链接' }}
            </button>
            <button
              v-if="isEditing"
              class="btn btn-ghost"
              type="button"
              data-testid="public-view-cancel-edit"
              @click="cancelEdit"
            >
              取消编辑
            </button>
          </div>
          <p v-else class="empty-hint">当前为只读，仅可查看已创建的公开链接。</p>
        </div>

        <div class="public-list">
          <h4>已创建</h4>
          <div
            v-for="view in views"
            :key="view.id"
            class="public-row"
            :class="{ editing: editingId === view.id }"
            data-testid="public-view-row"
          >
            <div>
              <strong>{{ view.name }}</strong>
              <small>
                {{ view.passwordRequired ? '密码保护' : '无密码' }}
                · {{ scopeLabel(view) }}
                <template v-if="view.expiresAt">
                  · 至 {{ new Date(view.expiresAt).toLocaleDateString() }}
                </template>
              </small>
              <a :href="view.url" target="_blank" rel="noreferrer">{{
                view.url
              }}</a>
            </div>
            <div class="row-actions">
              <button
                v-if="editable"
                class="btn btn-ghost"
                data-testid="public-view-edit"
                @click="beginEdit(view)"
              >
                编辑
              </button>
              <button
                class="btn btn-ghost"
                data-testid="public-view-copy"
                @click="copy(view)"
              >
                复制
              </button>
              <button
                v-if="editable"
                class="btn btn-danger"
                data-testid="public-view-revoke"
                @click="revoke(view)"
              >
                撤销
              </button>
            </div>
          </div>
          <p v-if="!views.length && !loading" class="empty-hint">
            暂无公开链接。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.public-panel {
  display: flex;
  flex-direction: column;
  width: min(920px, 96vw);
  height: min(640px, 88vh);
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
.public-body {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
}
.scope-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 12px;
  border-right: 1px solid #e5e6eb;
  background: #fafbfc;
  overflow: auto;
}
.scope-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.scope-head h4,
.public-form h4,
.public-list h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.public-form-fields {
  margin: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
}
.scope-hint {
  margin: 0 0 4px;
  color: #8a9099;
  font-size: 11px;
  line-height: 1.4;
}
.nl-link {
  border: 0;
  background: transparent;
  color: #2d6cdf;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.nl-link:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}
.nl-link:not(:disabled):hover {
  text-decoration: underline;
}
.scope-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}
.scope-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #8a9099;
  letter-spacing: 0.02em;
  padding: 4px 8px 2px;
}
.scope-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 13px;
  color: #1f2329;
  cursor: pointer;
}
.scope-row:hover:not(.disabled) {
  background: #eef2f7;
}
.scope-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.scope-row span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scope-row em {
  flex-shrink: 0;
  font-style: normal;
  font-size: 11px;
  color: #8a9099;
}
.group-empty {
  margin: 0;
  padding: 4px 8px 8px;
  color: #c0c4cc;
  font-size: 12px;
}
.public-main {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-width: 0;
  min-height: 0;
}
.public-form,
.public-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  overflow: auto;
}
.public-form {
  border-right: 1px solid #e5e6eb;
}
.public-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #646a73;
}
.public-form input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 7px;
  background: #fff;
  font-size: 13px;
}
.public-form input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.12);
}
.public-form .btn-primary {
  margin-top: 6px;
  align-self: stretch;
}
.public-form .btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.form-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.password-clear {
  flex-direction: row !important;
  align-items: center;
  padding: 0;
  cursor: pointer;
}
.public-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  background: #fff;
}
.public-row:hover {
  border-color: #d0d7e3;
  background: #fafbfc;
}
.public-row.editing {
  border-color: #3370ff;
  background: #f5f8ff;
}
.public-row strong {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.public-row small {
  display: block;
  margin: 4px 0 6px;
  color: #8a9099;
  font-size: 12px;
}
.public-row a {
  color: #2d6cdf;
  font-size: 12px;
  word-break: break-all;
  text-decoration: none;
}
.row-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  flex-shrink: 0;
}
.empty-hint {
  margin: 24px 0;
  color: #8a9099;
  font-size: 13px;
  text-align: center;
}
</style>
