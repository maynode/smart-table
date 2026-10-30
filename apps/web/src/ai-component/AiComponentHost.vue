<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import {
  AI_COMPONENT_CHANNEL,
  buildSrcDoc,
  isFrameMessage,
  type AiComponentHostToFrame,
} from './bridge-protocol';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** modal=配置预览；cell=叠在格子上（默认） */
    placement?: 'cell' | 'modal';
    /** cell 模式：相对画布的 left/top/width/height */
    cellStyle?: Record<string, string>;
    title?: string;
    html: string;
    css?: string;
    js?: string;
    value: unknown;
    getCell: () => Promise<unknown>;
    setCell: (value: unknown) => Promise<void>;
    getRow?: (fieldIds?: string[]) => Promise<Record<string, unknown>>;
    setRow?: (patch: Record<string, unknown>) => Promise<void>;
    runAutomation?: (
      automationId: string,
      payload?: unknown,
    ) => Promise<unknown>;
    notify?: (message: string) => void;
  }>(),
  { placement: 'cell' },
);

const emit = defineEmits<{ close: [] }>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
/** ready/rpc 可能早于 Vue ref；用 message.source / load 记下窗口 */
let frameWindow: Window | null = null;

/** 必须稳定：父级滚动重绘若每次新 string，iframe 会反复 reload，init 永远丢 */
const srcDoc = computed(() =>
  buildSrcDoc({ html: props.html, css: props.css, js: props.js }),
);

/** Vue reactive Proxy 不能 structured clone / postMessage，需先剥成纯数据 */
function cloneForPost(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
      return null;
    }
  }
}

function post(msg: AiComponentHostToFrame, target?: Window | null): boolean {
  const win =
    target ?? frameWindow ?? iframeRef.value?.contentWindow ?? null;
  if (!win) return false;
  let payload: AiComponentHostToFrame = msg;
  if (msg.type === 'init' || msg.type === 'cellChanged') {
    payload = { ...msg, value: cloneForPost(msg.value) };
  } else if (msg.type === 'rpcResult') {
    payload = { ...msg, result: cloneForPost(msg.result) };
  }
  try {
    win.postMessage(payload, '*');
    return true;
  } catch {
    return false;
  }
}

async function resolveCellValue(fallback: unknown): Promise<unknown> {
  try {
    return await props.getCell();
  } catch {
    return fallback;
  }
}

async function pushCellValue(
  value: unknown,
  target?: Window | null,
): Promise<void> {
  const next = await resolveCellValue(value);
  post(
    {
      channel: AI_COMPONENT_CHANNEL,
      type: 'init',
      value: next,
    },
    target,
  );
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && props.open) {
    ev.preventDefault();
    emit('close');
  }
}

function bindFrameWindow(win: Window | null): void {
  if (win) frameWindow = win;
}

async function onMessage(ev: MessageEvent): Promise<void> {
  if (!isFrameMessage(ev.data)) return;
  // sandbox 无 allow-same-origin：用 ev.source 回帖，勿与 contentWindow 做 ===。
  // 勿探测 source 上其它属性（跨域可读面积极窄，乱读会抛错导致整段 handler 中断）。
  const sourceWin = (ev.source as Window | null) ?? null;
  if (sourceWin) bindFrameWindow(sourceWin);

  const data = ev.data;
  if (data.type === 'ready') {
    await pushCellValue(props.value, sourceWin);
    return;
  }
  if (data.type !== 'rpc') return;

  const reply = async (ok: boolean, result?: unknown, error?: string) => {
    post(
      {
        channel: AI_COMPONENT_CHANNEL,
        type: 'rpcResult',
        id: data.id,
        ok,
        result,
        error,
      },
      sourceWin,
    );
  };
  try {
    switch (data.method) {
      case 'getCell':
        await reply(true, await props.getCell());
        break;
      case 'setCell':
        await props.setCell((data.args?.[0] ?? null) as unknown);
        await reply(true, true);
        break;
      case 'getRow':
        await reply(
          true,
          (await props.getRow?.(data.args?.[0] as string[] | undefined)) ?? {},
        );
        break;
      case 'setRow':
        await props.setRow?.(
          (data.args?.[0] ?? {}) as Record<string, unknown>,
        );
        await reply(true, true);
        break;
      case 'runAutomation':
        await reply(
          true,
          await props.runAutomation?.(
            String(data.args?.[0] ?? ''),
            data.args?.[1],
          ),
        );
        break;
      case 'notify':
        props.notify?.(String(data.args?.[0] ?? ''));
        await reply(true, true);
        break;
      default:
        await reply(false, undefined, 'unknown method');
    }
  } catch (error) {
    await reply(
      false,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function onIframeLoad(ev: Event): void {
  const el = ev.target as HTMLIFrameElement;
  bindFrameWindow(el.contentWindow);
  void pushCellValue(props.value, el.contentWindow);
}

watch(
  () => props.value,
  (value) => {
    post({
      channel: AI_COMPONENT_CHANNEL,
      type: 'cellChanged',
      value,
    });
  },
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      frameWindow = null;
      return;
    }
    void nextTick(() => {
      void pushCellValue(props.value);
    });
  },
  { immediate: true },
);

// setup 同步挂上，避免 srcdoc 极速 ready 赶在 onMounted 前
window.addEventListener('message', onMessage);
window.addEventListener('keydown', onKeydown);
onMounted(() => {
  void nextTick(() => {
    void pushCellValue(props.value);
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  window.removeEventListener('keydown', onKeydown);
  frameWindow = null;
});
</script>

<template>
  <!-- 格内叠层：跟单元格编辑器一样，盖在格子上 -->
  <div
    v-if="open && placement === 'cell'"
    class="ai-component-cell"
    data-testid="ai-component-host"
    :style="cellStyle"
    @mousedown.stop
    @click.stop
  >
    <iframe
      ref="iframeRef"
      class="ai-component-frame ai-component-frame--cell"
      title="ai-component"
      sandbox="allow-scripts"
      :srcdoc="srcDoc"
      @load="onIframeLoad"
    />
  </div>

  <!-- 仅配置预览用弹层 -->
  <Teleport v-else-if="open && placement === 'modal'" to="body">
    <div
      class="ai-component-host-backdrop"
      data-testid="ai-component-host"
      @click.self="emit('close')"
    >
      <div class="ai-component-host" @click.stop>
        <header class="ai-component-host-head">
          <strong>{{ title || '智能组件' }}</strong>
          <button type="button" class="btn btn-ghost" @click="emit('close')">
            关闭
          </button>
        </header>
        <iframe
          ref="iframeRef"
          class="ai-component-frame"
          title="ai-component"
          sandbox="allow-scripts"
          :srcdoc="srcDoc"
          @load="onIframeLoad"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-component-cell {
  position: absolute;
  z-index: 30;
  box-sizing: border-box;
  border: 2px solid #1d6fdc;
  border-radius: 2px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(31, 35, 41, 0.12);
}
.ai-component-frame {
  border: 0;
  width: 100%;
  height: 280px;
  background: #fff;
  display: block;
}
.ai-component-frame--cell {
  height: 100%;
  min-height: 32px;
}
.ai-component-host-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ai-component-host {
  width: min(480px, 100%);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ai-component-host-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
</style>
