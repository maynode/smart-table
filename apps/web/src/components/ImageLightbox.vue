<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    images: string[];
    index?: number;
    testId?: string;
  }>(),
  { index: 0 },
);

const emit = defineEmits<{
  close: [];
  'update:index': [value: number];
}>();

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const SCALE_STEP = 1.2;

const currentIndex = ref(props.index);
const scale = ref(1);
const rotate = ref(0);
const tx = ref(0);
const ty = ref(0);

const dragging = ref(false);
const moved = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let originTx = 0;
let originTy = 0;

const currentSrc = computed(
  () => props.images[currentIndex.value] ?? props.images[0] ?? '',
);
const canPrev = computed(
  () => props.images.length > 1 && currentIndex.value > 0,
);
const canNext = computed(
  () =>
    props.images.length > 1 && currentIndex.value < props.images.length - 1,
);
const counterText = computed(() => {
  if (props.images.length <= 1) return '';
  return `${currentIndex.value + 1}/${props.images.length}`;
});

const transformStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) rotate(${rotate.value}deg) scale(${scale.value})`,
}));

function resetView(): void {
  scale.value = 1;
  rotate.value = 0;
  tx.value = 0;
  ty.value = 0;
}

function goTo(next: number): void {
  if (next < 0 || next >= props.images.length || next === currentIndex.value) {
    return;
  }
  currentIndex.value = next;
  emit('update:index', next);
  resetView();
}

function prev(): void {
  if (canPrev.value) goTo(currentIndex.value - 1);
}

function next(): void {
  if (canNext.value) goTo(currentIndex.value + 1);
}

watch(
  () => props.index,
  (value) => {
    if (value !== currentIndex.value) {
      currentIndex.value = value;
      resetView();
    }
  },
);

watch(currentSrc, () => resetView());

function clampScale(nextScale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
}

function zoomBy(factor: number): void {
  scale.value = clampScale(scale.value * factor);
}

function zoomIn(): void {
  zoomBy(SCALE_STEP);
}

function zoomOut(): void {
  zoomBy(1 / SCALE_STEP);
}

function rotateLeft(): void {
  rotate.value = (rotate.value - 90) % 360;
}

function rotateRight(): void {
  rotate.value = (rotate.value + 90) % 360;
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const factor = event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP;
  zoomBy(factor);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  moved.value = false;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  originTx = tx.value;
  originTy = ty.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  if (Math.abs(dx) + Math.abs(dy) > 3) moved.value = true;
  tx.value = originTx + dx;
  ty.value = originTy + dy;
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function onBackdropClick(): void {
  if (moved.value) {
    moved.value = false;
    return;
  }
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    prev();
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    next();
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomIn();
    return;
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    zoomOut();
    return;
  }
  if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    if (event.shiftKey) rotateLeft();
    else rotateRight();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    class="image-lightbox"
    data-feedback-capture-ignore="1"
    :data-testid="testId || 'image-lightbox'"
    role="dialog"
    aria-modal="true"
    aria-label="图片预览"
    @click.self="onBackdropClick"
  >
    <div
      class="image-lightbox-stage"
      :class="{ dragging }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.stop
    >
      <img
        v-if="currentSrc"
        :src="currentSrc"
        alt="预览"
        class="image-lightbox-img"
        draggable="false"
        :style="transformStyle"
      />
    </div>

    <button
      type="button"
      class="image-lightbox-btn image-lightbox-nav image-lightbox-nav-prev"
      title="上一张"
      aria-label="上一张"
      :disabled="!canPrev"
      @click.stop="prev"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M15 18l-6-6 6-6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button
      type="button"
      class="image-lightbox-btn image-lightbox-nav image-lightbox-nav-next"
      title="下一张"
      aria-label="下一张"
      :disabled="!canNext"
      @click.stop="next"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 18l6-6-6-6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div class="image-lightbox-toolbar" @click.stop>
      <button
        type="button"
        class="image-lightbox-btn"
        title="放大"
        aria-label="放大"
        @click="zoomIn"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
          <path
            d="M21 21l-4.35-4.35M11 8v6M8 11h6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="image-lightbox-btn"
        title="缩小"
        aria-label="缩小"
        @click="zoomOut"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
          <path
            d="M21 21l-4.35-4.35M8 11h6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="image-lightbox-btn"
        title="左转"
        aria-label="左转"
        @click="rotateLeft"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M3 3v5h5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="image-lightbox-btn"
        title="右转"
        aria-label="右转"
        @click="rotateRight"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M21 3v5h-5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="image-lightbox-btn"
        title="复位"
        aria-label="复位"
        @click="resetView"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M21 3v5h-5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M8 16H3v5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span v-if="counterText" class="image-lightbox-counter">{{
        counterText
      }}</span>
      <button
        type="button"
        class="image-lightbox-btn image-lightbox-close"
        title="关闭"
        aria-label="关闭预览"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 6L6 18M6 6l12 12"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.78);
  user-select: none;
}

.image-lightbox-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.image-lightbox-stage.dragging {
  cursor: grabbing;
}

.image-lightbox-img {
  max-width: min(960px, 92vw);
  max-height: min(78vh, 100%);
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  pointer-events: none;
  background: #111;
  border-radius: 4px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}

.image-lightbox-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 44px;
  height: 44px;
  transform: translateY(-50%);
  border-radius: 50%;
}

.image-lightbox-nav-prev {
  left: max(16px, env(safe-area-inset-left, 0px));
}

.image-lightbox-nav-next {
  right: max(16px, env(safe-area-inset-right, 0px));
}

.image-lightbox-toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
}

.image-lightbox-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
}

.image-lightbox-btn svg {
  width: 20px;
  height: 20px;
  display: block;
  overflow: visible;
}

.image-lightbox-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.65);
}

.image-lightbox-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.image-lightbox-counter {
  min-width: 40px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
}

.image-lightbox-close {
  margin-left: 2px;
}
</style>
