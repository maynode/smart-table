import { describe, expect, it } from 'vitest';
import {
  AI_HOST_MIN_HEIGHT,
  AI_HOST_MIN_WIDTH,
  styleForAiComponentHost,
} from './hostLayout';

describe('styleForAiComponentHost', () => {
  it('expands beyond row height so complex controls are not crushed', () => {
    const style = styleForAiComponentHost(
      { x: 100, y: 80, width: 160, height: 36 },
      { width: 1200, height: 700 },
    );
    expect(Number.parseInt(style.width!, 10)).toBeGreaterThanOrEqual(
      AI_HOST_MIN_WIDTH,
    );
    expect(Number.parseInt(style.height!, 10)).toBeGreaterThanOrEqual(
      AI_HOST_MIN_HEIGHT,
    );
    expect(style.left).toBe('100px');
    expect(style.top).toBe('80px');
  });

  it('clamps into the grid viewport near the bottom-right edge', () => {
    const style = styleForAiComponentHost(
      { x: 1100, y: 650, width: 120, height: 36 },
      { width: 1200, height: 700 },
    );
    const left = Number.parseInt(style.left!, 10);
    const top = Number.parseInt(style.top!, 10);
    const width = Number.parseInt(style.width!, 10);
    const height = Number.parseInt(style.height!, 10);
    expect(left + width).toBeLessThanOrEqual(1200 - 8);
    expect(top + height).toBeLessThanOrEqual(700 - 8);
  });
});
