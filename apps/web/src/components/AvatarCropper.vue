<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AVATAR_OUTPUT_SIZE, canvasToAvatarBlob } from '../utils/avatar';

const props = defineProps<{
  file: File;
  busy?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [blob: Blob];
}>();

const viewport = 280;
/** 已按 EXIF 纠正方向的位图，宽高比即真实比例 */
const bitmap = ref<ImageBitmap | null>(null);
const previewUrl = ref('');
const ready = ref(false);
const error = ref('');
const scale = ref(1);
/** 「完整放入」圆框时的缩放，作为 1× 基准 */
const fitScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
const lastX = ref(0);
const lastY = ref(0);

/** 相对完整放入：最小可缩到 0.1×，最大 10× */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const minScale = computed(() => fitScale.value * MIN_ZOOM);
const maxScale = computed(() => fitScale.value * MAX_ZOOM);

const zoomFactorLabel = computed(() => {
  if (!ready.value || fitScale.value <= 0) return '1×';
  const factor = scale.value / fitScale.value;
  if (factor >= 10) return `${Math.round(factor)}×`;
  if (factor >= 1) return `${Math.round(factor * 10) / 10}×`;
  return `${Math.round(factor * 100) / 100}×`;
});

/** 滑杆用对数映射，缩小/放大全段都好拖 */
const zoomSlider = computed({
  get() {
    if (fitScale.value <= 0) return 0;
    const factor = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, scale.value / fitScale.value),
    );
    return Math.log(factor / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
  },
  set(t: number) {
    if (fitScale.value <= 0) return;
    const clamped = Math.min(1, Math.max(0, t));
    const factor = MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** clamped;
    setScaleAroundCenter(fitScale.value * factor);
  },
});

watch(
  () => props.file,
  (file) => {
    void loadFile(file);
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  cleanup();
});

function cleanup(): void {
  bitmap.value?.close();
  bitmap.value = null;
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

async function loadFile(file: File): Promise<void> {
  error.value = '';
  ready.value = false;
  cleanup();
  try {
    const bmp = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    } as ImageBitmapOptions);
    bitmap.value = bmp;

    const preview = document.createElement('canvas');
    preview.width = bmp.width;
    preview.height = bmp.height;
    const pctx = preview.getContext('2d');
    if (!pctx) throw new Error('无法读取图片');
    pctx.drawImage(bmp, 0, 0);
    previewUrl.value = preview.toDataURL('image/png');

    const fit = Math.min(viewport / bmp.width, viewport / bmp.height);
    fitScale.value = fit;
    scale.value = fit;
    offsetX.value = (viewport - bmp.width * fit) / 2;
    offsetY.value = (viewport - bmp.height * fit) / 2;
    ready.value = true;
  } catch {
    error.value = '无法读取该图片';
  }
}

function clampOffsets(): void {
  const bmp = bitmap.value;
  if (!bmp) return;
  const w = bmp.width * scale.value;
  const h = bmp.height * scale.value;
  const minVisible = 32;
  offsetX.value = Math.min(
    viewport - minVisible,
    Math.max(minVisible - w, offsetX.value),
  );
  offsetY.value = Math.min(
    viewport - minVisible,
    Math.max(minVisible - h, offsetY.value),
  );
}

function setScaleAroundCenter(next: number): void {
  const clamped = Math.min(maxScale.value, Math.max(minScale.value, next));
  const cx = viewport / 2;
  const cy = viewport / 2;
  const ratio = clamped / scale.value;
  offsetX.value = cx - (cx - offsetX.value) * ratio;
  offsetY.value = cy - (cy - offsetY.value) * ratio;
  scale.value = clamped;
  clampOffsets();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  if (fitScale.value <= 0) return;
  const factor = Math.max(MIN_ZOOM, scale.value / fitScale.value);
  const nextFactor = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, factor * (event.deltaY > 0 ? 1 / 1.1 : 1.1)),
  );
  setScaleAroundCenter(fitScale.value * nextFactor);
}

function nudgeZoom(dir: -1 | 1): void {
  if (!ready.value || props.busy || fitScale.value <= 0) return;
  const factor = Math.max(MIN_ZOOM, scale.value / fitScale.value);
  const nextFactor = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, factor * (dir > 0 ? 1.12 : 1 / 1.12)),
  );
  setScaleAroundCenter(fitScale.value * nextFactor);
}

function startDrag(event: PointerEvent): void {
  if (!ready.value || props.busy) return;
  dragging.value = true;
  lastX.value = event.clientX;
  lastY.value = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onDrag(event: PointerEvent): void {
  if (!dragging.value) return;
  offsetX.value += event.clientX - lastX.value;
  offsetY.value += event.clientY - lastY.value;
  lastX.value = event.clientX;
  lastY.value = event.clientY;
  clampOffsets();
}

function endDrag(): void {
  dragging.value = false;
}


async function confirm(): Promise<void> {
  const bmp = bitmap.value;
  if (!bmp || props.busy) return;
  error.value = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法裁剪');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    const ratio = AVATAR_OUTPUT_SIZE / viewport;
    ctx.drawImage(
      bmp,
      offsetX.value * ratio,
      offsetY.value * ratio,
      bmp.width * scale.value * ratio,
      bmp.height * scale.value * ratio,
    );
    const blob = await canvasToAvatarBlob(canvas);
    emit('confirm', blob);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '裁剪失败';
  }
}

const previewStyle = computed(() => {
  const bmp = bitmap.value;
  if (!bmp) return {};
  return {
    width: `${bmp.width * scale.value}px`,
    height: `${bmp.height * scale.value}px`,
    transform: `translate(${offsetX.value}px, ${offsetY.value}px)`,
  };
});
</script>

<template>
  <div class="cropper" data-testid="avatar-cropper">
    <div class="stage-wrap">
      <div
        class="stage"
        :class="{ dragging, ready }"
        @wheel="onWheel"
        @pointerdown="startDrag"
      >
        <img
          v-if="previewUrl"
          class="source"
          :src="previewUrl"
          alt=""
          draggable="false"
          :style="previewStyle"
        />
        <div class="ring" aria-hidden="true" />
        <div v-if="!ready && !error" class="stage-loading">加载中…</div>
      </div>
    </div>

    <div class="zoom-bar">
      <button
        class="zoom-btn"
        type="button"
        aria-label="缩小"
        :disabled="!ready || busy || scale <= minScale"
        @click="nudgeZoom(-1)"
      >
        −
      </button>
      <input
        v-model.number="zoomSlider"
        class="zoom-range"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :disabled="!ready || busy"
      />
      <button
        class="zoom-btn"
        type="button"
        aria-label="放大"
        :disabled="!ready || busy || scale >= maxScale"
        @click="nudgeZoom(1)"
      >
        +
      </button>
      <span class="zoom-pct">{{ zoomFactorLabel }}</span>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button
        class="btn btn-ghost"
        type="button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        重选图片
      </button>
      <button
        class="btn btn-primary"
        type="button"
        data-testid="avatar-crop-confirm"
        :disabled="!ready || busy"
        @click="confirm"
      >
        {{ busy ? '上传中…' : '保存头像' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cropper {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 4px;
}

.stage-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.stage {
  position: relative;
  width: 280px;
  height: 280px;
  overflow: hidden;
  border-radius: 50%;
  background: #dfe3e8;
  cursor: grab;
  touch-action: none;
  user-select: none;
  box-shadow:
    0 0 0 1px rgba(31, 35, 41, 0.06),
    0 10px 28px rgba(31, 35, 41, 0.12);
  transition: box-shadow 0.15s ease;
}

.stage.ready {
  background: #cfd5dc;
}

.stage.dragging {
  cursor: grabbing;
  box-shadow:
    0 0 0 2px rgba(45, 140, 240, 0.35),
    0 12px 32px rgba(31, 35, 41, 0.16);
}

.source {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  object-fit: fill;
  pointer-events: none;
}

.ring {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: 50%;
  box-shadow:
    inset 0 0 0 1px rgba(31, 35, 41, 0.12),
    0 0 0 6px rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.stage-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 13px;
  background: rgba(247, 248, 250, 0.72);
}

.zoom-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.zoom-btn {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.zoom-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.zoom-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.zoom-range {
  flex: 1;
  min-width: 0;
  height: 4px;
  accent-color: var(--brand);
  cursor: pointer;
}

.zoom-pct {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  text-align: center;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
</style>
