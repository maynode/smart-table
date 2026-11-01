import { computed, onMounted, onUnmounted, ref } from 'vue';
import { viewportModeFromWidth, type ViewportMode } from './viewport';

function readWidth(): number {
  if (typeof window === 'undefined') return 1200;
  return window.innerWidth;
}

/**
 * Reactive viewport mode for responsive shells.
 * Defaults to desktop when `window` is unavailable (SSR / tests without DOM size).
 */
export function useViewport() {
  const width = ref(readWidth());

  function refresh() {
    width.value = readWidth();
  }

  onMounted(() => {
    refresh();
    window.addEventListener('resize', refresh, { passive: true });
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', refresh);
    }
  });

  const mode = computed<ViewportMode>(() => viewportModeFromWidth(width.value));
  const isPhone = computed(() => mode.value === 'phone');
  const isTablet = computed(() => mode.value === 'tablet');
  const isDesktop = computed(() => mode.value === 'desktop');

  return { width, mode, isPhone, isTablet, isDesktop, refresh };
}
