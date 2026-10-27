<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { LiveEvent } from 'shared';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';
import { liveBus } from '../sync/live-bus';
import { confirmDialog, promptDialog } from '../ui/dialog';
import { toast } from '../ui/toast';
import { renderSimpleMarkdown } from '../ui/simple-markdown';
import type {
  AnalysisMessageAttachmentDto,
  AnalysisReportDto,
  AnalysisReportListItemDto,
  SheetDto,
} from '../api/types';

const FILE_MAX_BYTES = 100 * 1024 * 1024;

type PendingFile = {
  localId: string;
  previewUrl: string | null;
  name: string;
  size: number;
  mimetype: string;
  isImage: boolean;
  uploading: boolean;
  error?: string;
  uploaded?: AnalysisMessageAttachmentDto;
};

function isImageMime(type: string): boolean {
  return type.startsWith('image/');
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const props = withDefaults(
  defineProps<{
    baseId: string;
    sheets: SheetDto[];
    /** 从壳层新建时传入，直接打开该报告 */
    reportId?: string;
    /** 嵌入 Base 右侧主区（非弹窗） */
    embedded?: boolean;
    editable?: boolean;
  }>(),
  { embedded: false, editable: true },
);

const emit = defineEmits<{
  close: [];
  /** 嵌入模式下新建报告后通知壳层切换侧栏选中 */
  created: [reportId: string];
}>();

const list = ref<AnalysisReportListItemDto[]>([]);
const active = ref<AnalysisReportDto | null>(null);
const loading = ref(false);
const submitting = ref(false);
const draft = ref('');
const pendingFiles = ref<PendingFile[]>([]);
const chatEnd = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const busy = computed(() =>
  ['exploring', 'generating'].includes(active.value?.status ?? ''),
);

const reportHtml = computed(() => {
  const md = active.value?.reportMarkdown;
  if (!md) return '';
  return renderSimpleMarkdown(md);
});

const readyAttachments = computed(() =>
  pendingFiles.value
    .filter((p) => p.uploaded && !p.error)
    .map((p) => p.uploaded!),
);

const uploadingFiles = computed(() =>
  pendingFiles.value.some((p) => p.uploading),
);

const canSend = computed(
  () =>
    Boolean(active.value) &&
    (Boolean(draft.value.trim()) || readyAttachments.value.length > 0) &&
    !uploadingFiles.value &&
    !submitting.value &&
    !busy.value &&
    !loading.value,
);

function clearPendingFiles(): void {
  for (const item of pendingFiles.value) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
  pendingFiles.value = [];
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '网络错误';
}

const STATUS_LABELS: Record<string, string> = {
  draft: '对话中',
  asking: '对话中',
  exploring: '分析中',
  generating: '思考中',
  ready: '已有报告',
  failed: '失败',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

async function scrollChat(): Promise<void> {
  await nextTick();
  chatEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function loadList(): Promise<void> {
  const cacheKey = `analysis-list:${props.baseId}`;
  try {
    list.value = await endpoints.listAnalysisReports(props.baseId);
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'analysis', list.value);
  } catch (error) {
    const { localDb } = await import('../sync/local-db-client');
    const cached = (await localDb.getObjectCache(cacheKey)) as
      | AnalysisReportListItemDto[]
      | null;
    if (cached?.length) {
      list.value = cached;
      toast('已从离线缓存打开分析列表');
    } else {
      throw error;
    }
  }
}

async function openReport(id: string): Promise<void> {
  loading.value = true;
  const cacheKey = `analysis-report:${id}`;
  try {
    active.value = await endpoints.getAnalysisReport(id);
    const { localDb } = await import('../sync/local-db-client');
    void localDb.putObjectCache(cacheKey, 'analysis', active.value);
    draft.value = '';
    clearPendingFiles();
    await scrollChat();
    await nextTick();
    inputRef.value?.focus();
  } catch (error) {
    try {
      const { localDb } = await import('../sync/local-db-client');
      const cached = (await localDb.getObjectCache(cacheKey)) as
        | AnalysisReportDto
        | null;
      if (cached) {
        active.value = cached;
        draft.value = '';
        clearPendingFiles();
        toast('已从离线缓存打开分析报告（只读历史）');
        await scrollChat();
      } else {
        toast(messageOf(error));
      }
    } catch {
      toast(messageOf(error));
    }
  } finally {
    loading.value = false;
  }
}

async function startNew(): Promise<void> {
  if (!props.editable) {
    toast('当前为只读权限，无法新建分析');
    return;
  }
  const name = (await promptDialog('新分析报告名称', '分析报告'))?.trim();
  if (!name) return;
  loading.value = true;
  try {
    active.value = await endpoints.createAnalysisReport(props.baseId, name);
    await loadList();
    draft.value = '';
    clearPendingFiles();
    emit('created', active.value.id);
    await scrollChat();
    await nextTick();
    inputRef.value?.focus();
  } catch (error) {
    toast(messageOf(error));
  } finally {
    loading.value = false;
  }
}

async function enqueueFiles(files: FileList | File[]): Promise<void> {
  if (!props.editable) {
    toast('当前为只读权限，无法上传附件');
    return;
  }
  if (!active.value) return;
  const reportId = active.value.id;
  const list = Array.from(files);
  for (const file of list) {
    if (!file.size) {
      toast(`「${file.name || '文件'}」为空`);
      continue;
    }
    if (file.size > FILE_MAX_BYTES) {
      toast(`「${file.name}」超过 100MB`);
      continue;
    }
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = isImageMime(file.type);
    const pending: PendingFile = {
      localId,
      previewUrl: image ? URL.createObjectURL(file) : null,
      name: file.name || 'file',
      size: file.size,
      mimetype: file.type || 'application/octet-stream',
      isImage: image,
      uploading: true,
    };
    pendingFiles.value = [...pendingFiles.value, pending];
    try {
      const uploaded = await endpoints.uploadAnalysisAttachment(reportId, file);
      pendingFiles.value = pendingFiles.value.map((item) =>
        item.localId === localId
          ? { ...item, uploading: false, uploaded }
          : item,
      );
    } catch (error) {
      pendingFiles.value = pendingFiles.value.map((item) =>
        item.localId === localId
          ? { ...item, uploading: false, error: messageOf(error) }
          : item,
      );
      toast(messageOf(error));
    }
  }
}

function removePending(localId: string): void {
  const target = pendingFiles.value.find((p) => p.localId === localId);
  if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
  pendingFiles.value = pendingFiles.value.filter((p) => p.localId !== localId);
}

function openFilePicker(): void {
  fileInputRef.value?.click();
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) void enqueueFiles(input.files);
  input.value = '';
}

function onComposerPaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (!items?.length) return;
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) return;
  event.preventDefault();
  void enqueueFiles(files);
}

async function sendChat(): Promise<void> {
  if (!props.editable) return;
  if (!active.value || !canSend.value) return;
  const { offlineDecision, offlineBlockMessage } = await import(
    '../sync/offline-capability'
  );
  if (offlineDecision('analysis.generate') === 'block') {
    toast(offlineBlockMessage('analysis.generate'));
    return;
  }
  const text = draft.value.trim();
  const attachments = [...readyAttachments.value];
  const snapshotPending = [...pendingFiles.value];
  submitting.value = true;
  draft.value = '';
  pendingFiles.value = [];
  try {
    active.value = await endpoints.chatAnalysisReport(
      active.value.id,
      text,
      attachments,
    );
    for (const item of snapshotPending) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    await loadList();
    await scrollChat();
  } catch (error) {
    draft.value = text;
    pendingFiles.value = snapshotPending;
    toast(messageOf(error));
  } finally {
    submitting.value = false;
    await nextTick();
    inputRef.value?.focus();
  }
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  void sendChat();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPollIfBusy(): void {
  stopPoll();
  if (!busy.value || !active.value) return;
  const id = active.value.id;
  pollTimer = setInterval(() => {
    void (async () => {
      if (!active.value || active.value.id !== id) {
        stopPoll();
        return;
      }
      try {
        active.value = await endpoints.getAnalysisReport(id);
        await loadList();
        if (!busy.value) {
          stopPoll();
          if (active.value.status === 'ready') await scrollChat();
          if (active.value.status === 'failed') {
            toast(active.value.error || '分析失败');
          }
        }
      } catch {
        stopPoll();
      }
    })();
  }, 1500);
}

async function removeActive(): Promise<void> {
  if (!props.editable) return;
  if (!active.value) return;
  const ok = await confirmDialog(`删除分析报告「${active.value.name}」？`);
  if (!ok) return;
  try {
    const id = active.value.id;
    await endpoints.deleteAnalysisReport(id);
    stopPoll();
    active.value = null;
    await loadList();
    if (list.value[0]) {
      await openReport(list.value[0].id);
      if (props.embedded) emit('created', list.value[0].id);
    } else {
      emit('close');
    }
    toast('已删除');
  } catch (error) {
    toast(messageOf(error));
  }
}

watch(
  () => active.value?.status,
  async (status) => {
    if (status === 'ready') await scrollChat();
    startPollIfBusy();
  },
);

watch(
  () => props.reportId,
  async (id, prev) => {
    if (!id || id === prev) return;
    if (active.value?.id === id) return;
    await openReport(id);
    startPollIfBusy();
  },
);

const liveUnsubs: Array<() => void> = [];

async function onAnalysisLive(event: LiveEvent): Promise<void> {
  if (!active.value || event.entityId !== active.value.id) return;
  try {
    active.value = await endpoints.getAnalysisReport(active.value.id);
    await loadList();
    if (active.value.status === 'ready') await scrollChat();
    startPollIfBusy();
  } catch {
    /* live 刷新失败忽略 */
  }
}

async function onAnalysisDeleted(event: LiveEvent): Promise<void> {
  const deletedId = event.entityId;
  if (!deletedId) return;
  await loadList();
  if (active.value?.id !== deletedId) return;
  stopPoll();
  active.value = null;
  const next = list.value[0];
  if (next) {
    await openReport(next.id);
    if (props.embedded) emit('created', next.id);
    startPollIfBusy();
    return;
  }
  emit('close');
}

onMounted(async () => {
  liveUnsubs.push(
    liveBus.on('analysis.message', onAnalysisLive),
    liveBus.on('analysis.updated', onAnalysisLive),
    liveBus.on('analysis.deleted', onAnalysisDeleted),
  );
  try {
    await loadList();
    if (props.reportId) {
      await openReport(props.reportId);
      startPollIfBusy();
      return;
    }
    if (list.value[0]) {
      await openReport(list.value[0].id);
      startPollIfBusy();
    }
  } catch (error) {
    toast(messageOf(error));
  }
});

onUnmounted(() => {
  while (liveUnsubs.length) liveUnsubs.pop()?.();
  stopPoll();
  clearPendingFiles();
});
</script>

<template>
  <section
    class="analysis-panel"
    :class="{ embedded }"
    data-testid="analysis-report-panel"
  >
    <header class="analysis-top" :class="{ embedded }">
      <div class="analysis-top-left">
        <strong>{{ active?.name || '分析报告' }}</strong>
        <span class="muted">AI 对话生成</span>
      </div>
      <div class="analysis-top-actions">
        <button
          v-if="editable"
          class="btn"
          type="button"
          data-testid="analysis-new"
          @click="startNew"
        >
          新建分析
        </button>
        <button
          v-if="editable && active"
          class="btn btn-ghost"
          type="button"
          data-testid="analysis-delete"
          @click="removeActive"
        >
          删除
        </button>
        <button
          class="icon-btn"
          type="button"
          data-testid="analysis-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div class="analysis-body">
      <aside class="analysis-list" v-if="!embedded && list.length > 1">
        <div class="list-head">历史</div>
        <button
          v-for="item in list"
          :key="item.id"
          type="button"
          class="list-item"
          :class="{ active: active?.id === item.id }"
          @click="openReport(item.id)"
        >
          <span class="list-name">{{ item.name }}</span>
          <small class="list-status" :data-status="item.status">{{ statusLabel(item.status) }}</small>
        </button>
      </aside>

      <div class="analysis-main">
        <div
          v-if="loading && !active"
          class="report-canvas loading"
          data-testid="analysis-report-loading"
        >
          <div class="spinner"></div>
          <p>加载中…</p>
        </div>
        <div
          v-else-if="active?.reportMarkdown"
          class="report-canvas"
          data-testid="analysis-report-body"
          v-html="reportHtml"
        ></div>
        <div v-else class="report-canvas empty">
          <template v-if="active?.error">
            <div class="empty-icon error" aria-hidden="true">!</div>
            <p class="empty-state-title">出错了</p>
            <p class="empty-state-hint">{{ active.error }}</p>
          </template>
          <template v-else>
            <div class="empty-icon" aria-hidden="true">◇</div>
            <p class="empty-state-title">暂无报告</p>
            <p class="empty-state-hint">
              在右侧和 AI 正常聊天；需要完整报告时直接说「生成分析报告」。
            </p>
          </template>
        </div>
      </div>

      <aside class="analysis-chat" data-testid="analysis-chat">
        <header class="chat-head">
          <strong>分析助手</strong>
          <span v-if="submitting || busy" class="chat-busy">思考中…</span>
        </header>

        <div class="messages" data-testid="analysis-messages">
          <div
            v-for="msg in active?.messages ?? []"
            :key="msg.id"
            class="bubble"
            :class="msg.role"
          >
            <div class="bubble-role">
              {{ msg.role === 'user' ? '我' : '分析助手' }}
            </div>
            <div
              v-if="msg.attachments?.length"
              class="bubble-attachments"
              data-testid="analysis-msg-attachments"
            >
              <a
                v-for="(att, idx) in msg.attachments"
                :key="`${msg.id}-${idx}`"
                class="bubble-attach"
                :class="{ image: isImageMime(att.mimetype) }"
                :href="att.url"
                target="_blank"
                rel="noopener noreferrer"
                :download="att.name"
              >
                <img
                  v-if="isImageMime(att.mimetype)"
                  :src="att.url"
                  :alt="att.name"
                />
                <span v-else class="bubble-file">
                  <span class="bubble-file-name">{{ att.name }}</span>
                  <span class="bubble-file-size">{{ formatBytes(att.size) }}</span>
                </span>
              </a>
            </div>
            <div v-if="msg.content" class="bubble-body">{{ msg.content }}</div>
          </div>
          <div ref="chatEnd"></div>
        </div>

        <footer
          v-if="editable"
          class="chat-composer"
          data-testid="analysis-composer"
        >
          <div
            v-if="pendingFiles.length"
            class="pending-files"
            data-testid="analysis-pending-files"
          >
            <div
              v-for="item in pendingFiles"
              :key="item.localId"
              class="pending-item"
              :class="{
                error: item.error,
                uploading: item.uploading,
                image: item.isImage,
              }"
            >
              <img
                v-if="item.isImage && item.previewUrl"
                :src="item.previewUrl"
                :alt="item.name"
              />
              <div v-else class="pending-file-meta">
                <span class="pending-file-name">{{ item.name }}</span>
                <span class="pending-file-size">{{ formatBytes(item.size) }}</span>
              </div>
              <span v-if="item.uploading" class="pending-badge">上传中</span>
              <span v-else-if="item.error" class="pending-badge error">失败</span>
              <button
                type="button"
                class="pending-remove"
                aria-label="移除附件"
                @click="removePending(item.localId)"
              >
                ×
              </button>
            </div>
          </div>
          <textarea
            ref="inputRef"
            v-model="draft"
            class="chat-input"
            rows="3"
            placeholder="输入消息，可粘贴/上传文件；Enter 发送，Shift+Enter 换行"
            data-testid="analysis-chat-input"
            :disabled="!active || submitting || busy || loading"
            @keydown="onComposerKeydown"
            @paste="onComposerPaste"
          />
          <div class="composer-actions">
            <input
              ref="fileInputRef"
              type="file"
              multiple
              hidden
              data-testid="analysis-file-input"
              @change="onFilePicked"
            />
            <button
              class="btn btn-ghost"
              type="button"
              data-testid="analysis-file-upload"
              :disabled="!active || submitting || busy || loading"
              @click="openFilePicker"
            >
              附件
            </button>
            <button
              class="btn btn-primary"
              type="button"
              data-testid="analysis-chat-send"
              :disabled="!canSend"
              @click="sendChat"
            >
              {{ submitting || busy ? '发送中…' : '发送' }}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.analysis-panel {
  width: min(1120px, 96vw);
  height: min(780px, 90vh);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
}
.analysis-panel.embedded {
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 0;
  box-shadow: none;
  background: #f7f8fa;
}
.analysis-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #eef0f3);
  background: #fff;
}
.analysis-top.embedded {
  padding: 14px 20px;
  flex: none;
}
.analysis-top-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.analysis-top-left strong {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.analysis-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted {
  color: var(--text-tertiary, #8f959e);
  font-size: 12px;
}
.analysis-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.analysis-list {
  width: 168px;
  border-right: 1px solid var(--border-light, #eef0f3);
  overflow: auto;
  padding: 10px 8px;
  background: #fafbfc;
}
.list-head {
  padding: 4px 10px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #8f959e);
  text-transform: uppercase;
}
.list-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s ease;
}
.list-item:hover {
  background: #f0f2f5;
}
.list-item.active {
  background: #e8f0ff;
}
.list-name {
  color: var(--text-primary, #1f2329);
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.list-item.active .list-name {
  color: #245bdb;
}
.list-status {
  font-size: 11px;
  color: var(--text-tertiary, #8f959e);
}
.list-status[data-status='ready'] {
  color: #0f9d58;
}
.list-status[data-status='failed'] {
  color: #d4380d;
}
.list-status[data-status='exploring'],
.list-status[data-status='generating'] {
  color: #3370ff;
}
.analysis-main {
  flex: 1.2;
  min-width: 0;
  background: #f5f6f8;
  border-right: 1px solid var(--border-light, #eef0f3);
}
.report-canvas {
  height: 100%;
  overflow: auto;
  padding: 28px 32px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-primary, #1f2329);
  background: #fff;
  margin: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-light, #eef0f3);
  box-sizing: border-box;
  width: calc(100% - 24px);
  height: calc(100% - 24px);
}
.report-canvas.loading,
.report-canvas.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 28px;
  color: var(--text-secondary, #646a73);
  text-align: center;
  background: transparent;
  border: 1px dashed #d9dee8;
}
.empty-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #eef3ff;
  color: #3370ff;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-icon.error {
  background: #fff1f0;
  color: #d4380d;
}
.report-canvas.empty .empty-state-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary, #4e5969);
}
.report-canvas.empty .empty-state-hint {
  margin: 0;
  max-width: 300px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-tertiary, #8a9099);
}
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e8ef;
  border-top-color: #3370ff;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.report-canvas :deep(h1) {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 14px;
  line-height: 1.3;
}
.report-canvas :deep(h2) {
  font-size: 16px;
  font-weight: 600;
  margin: 22px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light, #f0f2f5);
}
.report-canvas :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 6px;
}
.report-canvas :deep(p),
.report-canvas :deep(ul),
.report-canvas :deep(ol) {
  margin: 0 0 12px;
}
.report-canvas :deep(li) {
  margin-bottom: 4px;
}
.report-canvas :deep(blockquote) {
  margin: 0 0 14px;
  padding: 10px 14px;
  background: #f5f8ff;
  border-left: 3px solid #3370ff;
  border-radius: 0 6px 6px 0;
  color: var(--text-secondary, #4e5969);
}
.report-canvas :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 16px;
  font-size: 13px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}
.report-canvas :deep(.md-table th),
.report-canvas :deep(.md-table td) {
  border: 1px solid #e8eaed;
  padding: 8px 10px;
  text-align: left;
}
.report-canvas :deep(.md-table th) {
  background: #f7f8fa;
  font-weight: 600;
  color: var(--text-secondary, #646a73);
}
.analysis-chat {
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, #eef0f3);
}
.chat-head strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1f2329);
}
.chat-busy {
  font-size: 12px;
  color: #3370ff;
}
.messages {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bubble {
  max-width: 100%;
}
.bubble.user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.bubble-role {
  font-size: 11px;
  color: var(--text-tertiary, #8f959e);
  margin-bottom: 4px;
}
.bubble.user .bubble-body {
  background: #e8f3ff;
  color: #1f2329;
}
.bubble-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
  justify-content: flex-end;
}
.bubble:not(.user) .bubble-attachments {
  justify-content: flex-start;
}
.bubble-attach {
  display: block;
  max-width: 220px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e5e8ef;
  background: #fff;
  text-decoration: none;
  color: inherit;
}
.bubble-attach.image {
  width: 72px;
  height: 72px;
}
.bubble-attach.image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.bubble-file {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  min-width: 120px;
}
.bubble-file-name {
  font-size: 12px;
  font-weight: 500;
  color: #1f2329;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bubble-file-size {
  font-size: 11px;
  color: #8f959e;
}
.bubble-body {
  display: inline-block;
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  background: #f5f6f7;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-light, #eef0f3);
  background: #fafbfc;
}
.pending-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pending-item {
  position: relative;
  min-width: 64px;
  max-width: 180px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d0d3d9;
  background: #fff;
}
.pending-item.image {
  width: 64px;
  height: 64px;
}
.pending-item.image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pending-file-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 28px 10px 10px;
}
.pending-file-name {
  font-size: 12px;
  font-weight: 500;
  color: #1f2329;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending-file-size {
  font-size: 11px;
  color: #8f959e;
}
.pending-item.uploading,
.pending-item.error {
  opacity: 0.7;
}
.pending-badge {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  color: #fff;
  background: rgba(51, 112, 255, 0.9);
}
.pending-badge.error {
  background: rgba(212, 56, 13, 0.9);
}
.pending-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.65);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.chat-input {
  width: 100%;
  min-height: 72px;
  max-height: 160px;
  padding: 10px 12px;
  border: 1px solid #d0d3d9;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
  background: #fff;
  color: #1f2329;
}
.chat-input:focus {
  outline: none;
  border-color: #3370ff;
  box-shadow: 0 0 0 2px rgba(51, 112, 255, 0.15);
}
.chat-input:disabled {
  background: #f5f6f7;
  color: #8a9099;
}
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.composer-actions .btn-primary {
  min-width: 88px;
  margin-left: auto;
}
.composer-actions .btn-primary:disabled,
.composer-actions .btn-ghost:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
