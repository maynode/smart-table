import { computed, onBeforeUnmount, ref, type CSSProperties } from 'vue';

/**
 * 浮层标题栏拖动：拖起后改为 fixed，并限制在视口内。
 * 未拖动时 style 为 undefined，沿用原有 CSS 定位。
 */
export function useFloatDrag() {
  const root = ref<HTMLElement | null>(null);
  const offset = ref<{ x: number; y: number } | null>(null);

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  const style = computed((): CSSProperties | undefined => {
    if (!offset.value) return undefined;
    return {
      position: 'fixed',
      left: `${offset.value.x}px`,
      top: `${offset.value.y}px`,
      right: 'auto',
      bottom: 'auto',
      margin: '0',
      transform: 'none',
      zIndex: 220,
    };
  });

  function clamp(x: number, y: number): { x: number; y: number } {
    const el = root.value;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    offset.value = clamp(
      origX + event.clientX - startX,
      origY + event.clientY - startY,
    );
  }

  function onPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  function onHandlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, label')) return;
    const el = root.value;
    if (!el) return;

    event.preventDefault();
    const rect = el.getBoundingClientRect();
    offset.value = { x: rect.left, y: rect.top };
    startX = event.clientX;
    startY = event.clientY;
    origX = rect.left;
    origY = rect.top;
    dragging = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function reset(): void {
    onPointerUp();
    offset.value = null;
  }

  onBeforeUnmount(onPointerUp);

  return { root, style, onHandlePointerDown, reset };
}
