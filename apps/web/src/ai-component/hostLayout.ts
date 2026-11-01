/** Desktop in-grid AI host: popover over the cell, not crushed to row height. */

export type CellRect = { x: number; y: number; width: number; height: number };

export type HostViewport = { width: number; height: number };

export const AI_HOST_MIN_WIDTH = 300;
export const AI_HOST_MAX_WIDTH = 380;
export const AI_HOST_MIN_HEIGHT = 200;
export const AI_HOST_MAX_HEIGHT = 280;
const EDGE = 8;

/**
 * Size/position an in-cell AI component host as a popover anchored at the cell.
 * Spec: 浮层，避免把复杂控件塞进单行格子高度。
 */
export function styleForAiComponentHost(
  rect: CellRect,
  viewport: HostViewport,
): Record<string, string> {
  const maxW = Math.max(EDGE * 2, viewport.width - EDGE * 2);
  const maxH = Math.max(EDGE * 2, viewport.height - EDGE * 2);
  const width = Math.min(
    Math.max(rect.width, AI_HOST_MIN_WIDTH),
    Math.min(AI_HOST_MAX_WIDTH, maxW),
  );
  const height = Math.min(
    Math.max(AI_HOST_MIN_HEIGHT, rect.height),
    Math.min(AI_HOST_MAX_HEIGHT, maxH),
  );
  let left = rect.x;
  let top = rect.y;
  if (left + width > viewport.width - EDGE) {
    left = Math.max(EDGE, viewport.width - width - EDGE);
  }
  if (top + height > viewport.height - EDGE) {
    top = Math.max(EDGE, viewport.height - height - EDGE);
  }
  if (left < EDGE) left = EDGE;
  if (top < EDGE) top = EDGE;
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  };
}
