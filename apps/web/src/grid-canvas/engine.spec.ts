// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CanvasGridEngine } from './engine';

type FakeContext = CanvasRenderingContext2D & {
  drawImage: ReturnType<typeof vi.fn>;
};

function createFakeContext(): FakeContext {
  const context: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * 7 }),
    drawImage: vi.fn(),
  };
  const noop = () => undefined;
  for (const method of [
    'setTransform',
    'clearRect',
    'fillRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'save',
    'restore',
    'rect',
    'clip',
    'fillText',
    'strokeRect',
    'roundRect',
    'fill',
    'closePath',
  ]) {
    context[method] = noop;
  }
  return context as unknown as FakeContext;
}

function createHost(width = 800, height = 600): HTMLDivElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true });
  document.body.appendChild(host);
  return host;
}

describe('CanvasGridEngine', () => {
  let context: FakeContext;

  beforeAll(() => {
    context = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a bounded window for 100k rows without per-cell DOM', () => {
    const host = createHost();

    const engine = new CanvasGridEngine(host, {
      columns: [
        { id: 'serial', name: '序列号' },
        { id: 'status', name: '状态' },
        { id: 'phone', name: '手机号' },
      ],
      rowCount: 100_000,
      rowHeight: 32,
      getCell: (row, col) => ({ text: `R${row}C${col}` }),
    });

    engine.renderNow();
    const stats = engine.lastFrameStats;

    // 800x600 at 32px rows: ~23 rows x ~8 columns, never 100k.
    expect(stats.cellsDrawn).toBeGreaterThan(0);
    expect(stats.cellsDrawn).toBeLessThan(400);
    expect(stats.rows.end - stats.rows.start).toBeLessThan(40);

    // Only the three canvas layers exist; no DOM node per cell.
    expect(host.querySelectorAll('canvas')).toHaveLength(3);
    expect(host.querySelectorAll('.grid-cell')).toHaveLength(0);
    expect(host.querySelectorAll('.canvas-grid__layer')).toHaveLength(3);

    engine.destroy();
  });

  it('paints skeleton placeholders when getCell returns skeleton', () => {
    const host = createHost();
    const engine = new CanvasGridEngine(host, {
      columns: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      rowCount: 100,
      getCell: (row) =>
        row % 2 === 0 ? { text: '', skeleton: true } : { text: `R${row}` },
    });

    expect(() => engine.renderNow()).not.toThrow();
    expect(engine.lastFrameStats.cellsDrawn).toBeGreaterThan(0);
    engine.destroy();
  });

  it('uses the OffscreenCanvas path when available', () => {
    const host = createHost();
    const offscreenContext = createFakeContext();
    const offscreen = {
      width: 1,
      height: 1,
      getContext: () => offscreenContext,
    } as unknown as OffscreenCanvas;

    const engine = new CanvasGridEngine(host, {
      columns: [{ id: 'a', name: 'A' }],
      rowCount: 10,
      getCell: () => ({ text: 'x' }),
      offscreenFactory: () => offscreen,
    });

    engine.renderNow();

    expect(engine.usingOffscreenPath).toBe(true);
    expect(engine.lastFrameStats.usedOffscreen).toBe(true);
    expect(context.drawImage).toHaveBeenCalled();

    engine.destroy();
  });

  it('maps cell coordinates to overlay rectangles and scrolls them into view', () => {
    const host = createHost();

    const engine = new CanvasGridEngine(host, {
      columns: [{ id: 'a', name: 'A', width: 120 }],
      rowCount: 500,
      rowHeight: 30,
    });

    const rect = engine.cellRect(3, 0);
    expect(rect.y).toBe(40 + 3 * 30);
    expect(rect.height).toBe(30);
    expect(rect.width).toBe(120);

    engine.destroy();
  });

  it('keeps frozen columns fixed while horizontal scroll moves later columns', () => {
    const host = createHost(400, 300);
    const engine = new CanvasGridEngine(host, {
      columns: [
        { id: 'a', name: 'A', width: 100 },
        { id: 'b', name: 'B', width: 100 },
        { id: 'c', name: 'C', width: 100 },
        { id: 'd', name: 'D', width: 100 },
      ],
      rowCount: 20,
      freezeColumnCount: 1,
    });

    const before = engine.cellRect(0, 0).x;
    engine.scrollTo(150, 0);
    expect(engine.cellRect(0, 0).x).toBe(before);
    expect(engine.cellRect(0, 2).x).toBeLessThan(
      48 + 100 + 100 + 100 - 150 + 1,
    );
    expect(engine.cellRect(0, 2).x).toBe(48 + 200 - 150);

    engine.destroy();
  });
});
