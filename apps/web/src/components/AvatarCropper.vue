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
const minScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
const lastX = ref(0);
const lastY = ref(0);

const maxScale = computed(() => Math.max(minScale.value * 6, 4));

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
    // from-image：按 EXIF 纠正方向，避免预览与导出比例不一致/看起来被压扁
    const bmp = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    } as ImageBitmapOptions);
    bitmap.value = bmp;

    // 预览用 canvas 导出，保证与裁剪同源、同比例（不走 <img> 的另一套方向处理）
    const preview = document.createElement('canvas');
    preview.width = bmp.width;
    preview.height = bmp.height;
    const pctx = preview.getContext('2d');
    if (!pctx) throw new Error('无法读取图片');
    pctx.drawImage(bmp, 0, 0);
    previewUrl.value = preview.toDataURL('image/png');

    // 默认 contain：整图完整放入方框，等比缩放，不拉伸、不裁切
    const fit = Math.min(viewport / bmp.width, viewport / bmp.height);
    minScale.value = fit;
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
  // 自由拖动：只要还和裁剪框有一点重叠即可，不强制居中
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

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.08 : 0.08;
  const next = Math.min(
    maxScale.value,
    Math.max(minScale.value, scale.value + delta),
  );
  const cx = viewport / 2;
  const cy = viewport / 2;
  const ratio = next / scale.value;
  offsetX.value = cx - (cx - offsetX.value) * ratio;
  offsetY.value = cy - (cy - offsetY.value) * ratio;
  scale.value = next;
  clampOffsets();
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

function onScaleInput(): void {
  clampOffsets();
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
    // 宽高用同一 scale，保证等比，绝不拉伸
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
    <p class="hint">
      等比缩放不变形；可自由拖动位置，滚轮或滑杆缩放后取方形区域保存。
    </p>
    <div
      class="stage"
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
      <div class="mask" aria-hidden="true" />
    </div>
    <label class="zoom">
      <span>缩放</span>
      <input
        v-model.number="scale"
        type="range"
        :min="minScale"
        :max="maxScale"
        :step="0.01"
        :disabled="!ready || busy"
        @input="onScaleInput"
      />
    </label>
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
        {{ busy ? '上传中…' : '裁剪并保存' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cropper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  font-size: 13px;
  color: #646a73;
  line-height: 1.5;
}

.stage {
  position: relative;
  width: 280px;
  height: 280px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 12px;
  background: #1f2329;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.stage:active {
  cursor: grabbing;
}

.source {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  /* 宽高由脚本按原图比例写入，禁止被样式拉伸 */
  object-fit: fill;
  pointer-events: none;
}

.mask {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #646a73;
}

.zoom input {
  flex: 1;
}

.error {
  margin: 0;
  color: #d4380d;
  font-size: 13px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
