import {
  AxisLayout,
  UniformAxis,
  computeVisibleRange,
  type VisibleRange,
} from './layout';

export interface GridColumn {
  id: string;
  name: string;
  width?: number;
}

export interface CellRender {
  text: string;
  bg?: string;
  color?: string;
  bold?: boolean;
  /** Draw as a rounded status pill (select/status fields). */
  pill?: boolean;
}

export interface Selection {
  row: number;
  col: number;
}

export interface GridStats {
  cellsDrawn: number;
  rows: VisibleRange;
  columns: VisibleRange;
  usedOffscreen: boolean;
}

export interface CanvasGridOptions {
  columns: GridColumn[];
  rowCount: number;
  rowHeight?: number;
  headerHeight?: number;
  overscan?: number;
  getCell?: (row: number, col: number) => CellRender | null;
  onSelectionChange?: (selection: Selection | null) => void;
  onCellDoubleClick?: (selection: Selection) => void;
  onViewportChange?: (stats: GridStats) => void;
  onColumnResize?: (columnIndex: number, width: number) => void;
  offscreenFactory?: () => OffscreenCanvas | null;
}

type LayerName = 'grid' | 'content' | 'selection';

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

const COLORS = {
  background: '#ffffff',
  headerBackground: '#f7f7f8',
  border: '#e5e6eb',
  headerText: '#646a73',
  cellText: '#1f2329',
  selectionFill: 'rgba(45, 140, 240, 0.08)',
  selectionBorder: '#2d8cf0',
  emptyText: '#8f959e',
};

const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 36;
const COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 60;
const RESIZE_HIT_WIDTH = 5;

/**
 * Multi-layer Canvas grid: grid lines / content / selection are separate
 * canvases so a selection repaint never redraws the whole sheet, and content
 * is drawn through an OffscreenCanvas when the browser supports it.
 */
export class CanvasGridEngine {
  readonly canvases: Record<LayerName, HTMLCanvasElement>;
  readonly columns: GridColumn[] = [];

  private readonly contexts: Record<LayerName, CanvasRenderingContext2D>;
  private readonly rowHeight: number;
  private readonly headerHeight: number;
  private readonly overscan: number;
  private readonly offscreen: OffscreenCanvas | null;
  private readonly offscreenContext: OffscreenCanvasRenderingContext2D | null;

  private rowAxis: UniformAxis;
  private columnAxis: AxisLayout;
  private columnWidths: number[];
  private getCell: (row: number, col: number) => CellRender | null;
  private selection: Selection | null = null;
  private scrollX = 0;
  private scrollY = 0;
  private dpr = 1;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeState: {
    col: number;
    startX: number;
    startWidth: number;
  } | null = null;

  private stats: GridStats = {
    cellsDrawn: 0,
    rows: { start: 0, end: 0 },
    columns: { start: 0, end: 0 },
    usedOffscreen: false,
  };

  readonly usingOffscreenPath: boolean;

  private readonly scroller: HTMLDivElement;
  private readonly spacer: HTMLDivElement;

  constructor(
    private readonly host: HTMLElement,
    private options: CanvasGridOptions,
  ) {
    this.rowHeight = options.rowHeight ?? ROW_HEIGHT;
    this.headerHeight = options.headerHeight ?? HEADER_HEIGHT;
    this.overscan = options.overscan ?? 3;
    this.getCell = options.getCell ?? (() => null);

    // The host is positioned by CSS (absolute inset: 0); forcing
    // position:relative here would collapse it inside a flex row.
    host.style.overflow = 'hidden';
    host.classList.add('canvas-grid');

    this.scroller = document.createElement('div');
    this.scroller.className = 'canvas-grid__scroller';
    Object.assign(this.scroller.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'auto',
    });

    this.spacer = document.createElement('div');
    this.spacer.className = 'canvas-grid__spacer';
    this.spacer.style.position = 'relative';
    this.scroller.appendChild(this.spacer);
    host.appendChild(this.scroller);

    this.canvases = {} as Record<LayerName, HTMLCanvasElement>;
    this.contexts = {} as Record<LayerName, CanvasRenderingContext2D>;
    for (const layer of ['grid', 'content', 'selection'] as const) {
      const canvas = document.createElement('canvas');
      canvas.className = `canvas-grid__layer canvas-grid__layer--${layer}`;
      Object.assign(canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      });
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas 2D context is unavailable');
      }
      this.canvases[layer] = canvas;
      this.contexts[layer] = context;
      host.appendChild(canvas);
    }

    this.offscreen =
      options.offscreenFactory?.() ??
      (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null);
    this.offscreenContext = this.offscreen?.getContext('2d') ?? null;
    this.usingOffscreenPath = this.offscreenContext !== null;

    this.rowAxis = new UniformAxis(options.rowCount, this.rowHeight);
    this.columnWidths = options.columns.map((column) => {
      this.columns.push(column);
      return column.width ?? COLUMN_WIDTH;
    });
    this.columnAxis = new AxisLayout(this.columnWidths);

    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.onResizeEnd);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeCanvases();
        this.invalidate();
      });
      this.resizeObserver.observe(host);
    }

    this.resizeCanvases();
    this.renderNow();
  }

  get rowCount(): number {
    return this.rowAxis.count;
  }

  get lastFrameStats(): GridStats {
    return this.stats;
  }

  getSelection(): Selection | null {
    return this.selection;
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection;
    this.invalidate();
  }

  setRowCount(rowCount: number): void {
    this.rowAxis = new UniformAxis(rowCount, this.rowHeight);
    this.updateSpacer();
    this.invalidate();
  }

  setColumns(columns: GridColumn[]): void {
    this.columns.splice(0, this.columns.length, ...columns);
    this.columnWidths = columns.map((column) => column.width ?? COLUMN_WIDTH);
    this.columnAxis = new AxisLayout(this.columnWidths);
    this.updateSpacer();
    this.invalidate();
  }

  setCellProvider(
    provider: (row: number, col: number) => CellRender | null,
  ): void {
    this.getCell = provider;
    this.invalidate();
  }

  ensureCellVisible(row: number, col: number): void {
    const headerHeight = this.headerHeight;
    const top = this.rowAxis.offset(row);
    const bottom = top + this.rowAxis.size(row);
    const scrollTop = this.scroller.scrollTop;
    const viewportHeight = this.host.clientHeight - headerHeight;

    if (top < scrollTop) {
      this.scroller.scrollTop = top;
    } else if (bottom > scrollTop + viewportHeight) {
      this.scroller.scrollTop = bottom - viewportHeight;
    }

    const left = this.columnAxis.offset(col);
    const right = left + this.columnAxis.size(col);
    const scrollLeft = this.scroller.scrollLeft;
    const viewportWidth = this.host.clientWidth;

    if (left < scrollLeft) {
      this.scroller.scrollLeft = left;
    } else if (right > scrollLeft + viewportWidth) {
      this.scroller.scrollLeft = right - viewportWidth;
    }

    this.syncScrollPosition();
  }

  /** Viewport-relative rectangle for overlaying a DOM editor. */
  cellRect(row: number, col: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    return {
      x: this.columnAxis.offset(col) - this.scrollX,
      y: this.headerHeight + this.rowAxis.offset(row) - this.scrollY,
      width: this.columnAxis.size(col),
      height: this.rowAxis.size(row),
    };
  }

  scrollTo(x: number, y: number): void {
    this.scroller.scrollLeft = x;
    this.scroller.scrollTop = y;
    this.syncScrollPosition();
    this.invalidate();
  }

  invalidate(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  renderNow(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;

    this.updateSpacer();
    this.resizeCanvases();

    const bodyHeight = Math.max(0, height - this.headerHeight);
    const rows = computeVisibleRange(
      this.rowAxis,
      this.scrollY,
      bodyHeight,
      this.overscan,
    );
    const columns = computeVisibleRange(
      this.columnAxis,
      this.scrollX,
      width,
      this.overscan,
    );

    this.drawGrid(width, height, rows, columns);
    this.drawContent(width, height, rows, columns);
    this.drawSelection(width, height);

    this.stats = {
      cellsDrawn:
        Math.max(0, rows.end - rows.start) *
        Math.max(0, columns.end - columns.start),
      rows,
      columns,
      usedOffscreen: this.usingOffscreenPath,
    };
    this.options.onViewportChange?.(this.stats);
  }

  destroy(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeEnd);
    this.resizeObserver?.disconnect();
    this.host.innerHTML = '';
    this.host.classList.remove('canvas-grid');
  }

  private readonly onScroll = (): void => {
    this.syncScrollPosition();
    this.invalidate();
  };

  private syncScrollPosition(): void {
    this.scrollX = this.scroller.scrollLeft;
    this.scrollY = this.scroller.scrollTop;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = this.localPoint(event);
    if (point.x > this.host.clientWidth || point.y > this.host.clientHeight) {
      return;
    }

    if (point.y < this.headerHeight) {
      const boundary = this.columnBoundaryAt(point.x + this.scrollX);
      if (boundary !== null) {
        this.startResize(boundary, event);
      }
      return;
    }

    const row = this.rowAxis.indexAt(point.y - this.headerHeight + this.scrollY);
    const col = this.columnAxis.indexAt(point.x + this.scrollX);
    if (
      row < 0 ||
      row >= this.rowAxis.count ||
      col < 0 ||
      col >= this.columns.length
    ) {
      return;
    }

    this.selection = { row, col };
    this.options.onSelectionChange?.(this.selection);
    this.invalidate();
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    if (point.y < this.headerHeight) return;

    const row = this.rowAxis.indexAt(point.y - this.headerHeight + this.scrollY);
    const col = this.columnAxis.indexAt(point.x + this.scrollX);
    if (
      row < 0 ||
      row >= this.rowAxis.count ||
      col < 0 ||
      col >= this.columns.length
    ) {
      return;
    }

    this.selection = { row, col };
    this.options.onSelectionChange?.(this.selection);
    this.options.onCellDoubleClick?.(this.selection);
    this.invalidate();
  };

  private startResize(column: number, event: PointerEvent): void {
    this.resizeState = {
      col: column,
      startX: event.clientX,
      startWidth: this.columnWidths[column],
    };
    this.host.style.cursor = 'col-resize';
    event.preventDefault();
  }

  private readonly onResizeMove = (event: PointerEvent): void => {
    if (!this.resizeState) return;
    const width = Math.max(
      MIN_COLUMN_WIDTH,
      this.resizeState.startWidth + (event.clientX - this.resizeState.startX),
    );
    this.columnWidths[this.resizeState.col] = width;
    this.columnAxis = new AxisLayout(this.columnWidths);
    this.updateSpacer();
    this.invalidate();
  };

  private readonly onResizeEnd = (): void => {
    if (!this.resizeState) return;
    const { col } = this.resizeState;
    this.resizeState = null;
    this.host.style.cursor = '';
    this.options.onColumnResize?.(col, this.columnWidths[col]);
  };

  private columnBoundaryAt(worldX: number): number | null {
    for (let i = 0; i < this.columnWidths.length; i += 1) {
      const boundary = this.columnAxis.offset(i + 1);
      if (Math.abs(boundary - worldX) <= RESIZE_HIT_WIDTH) return i;
    }
    return null;
  }

  private localPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private updateSpacer(): void {
    this.spacer.style.width = `${Math.max(1, this.columnAxis.totalSize)}px`;
    this.spacer.style.height = `${Math.max(1, this.rowAxis.totalSize)}px`;
  }

  private resizeCanvases(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    for (const layer of ['grid', 'content', 'selection'] as const) {
      const canvas = this.canvases[layer];
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }
  }

  private prepareContext(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
    clear: boolean,
  ): void {
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (clear) context.clearRect(0, 0, width, height);
  }

  private drawGrid(
    width: number,
    height: number,
    rows: VisibleRange,
    columns: VisibleRange,
  ): void {
    const context = this.contexts.grid;
    this.prepareContext(context, width, height, true);

    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, width, height);

    // Header band.
    context.fillStyle = COLORS.headerBackground;
    context.fillRect(0, 0, width, this.headerHeight);
    context.strokeStyle = COLORS.border;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, this.headerHeight - 0.5);
    context.lineTo(width, this.headerHeight - 0.5);
    context.stroke();

    context.font = `600 12px ${FONT_STACK}`;
    context.textBaseline = 'middle';
    context.fillStyle = COLORS.headerText;

    context.save();
    context.beginPath();
    context.rect(0, 0, width, this.headerHeight);
    context.clip();
    for (let col = columns.start; col < columns.end; col += 1) {
      const column = this.columns[col];
      if (!column) continue;
      const x = this.columnAxis.offset(col) - this.scrollX;
      const columnWidth = this.columnAxis.size(col);
      if (x + columnWidth < 0 || x > width) continue;

      context.save();
      context.beginPath();
      context.rect(x, 0, columnWidth, this.headerHeight);
      context.clip();
      context.fillText(column.name, x + 12, this.headerHeight / 2);
      context.restore();
    }
    context.restore();

    // Body grid lines (viewport-only).
    context.save();
    context.beginPath();
    context.rect(0, this.headerHeight, width, height - this.headerHeight);
    context.clip();

    context.strokeStyle = COLORS.border;
    context.beginPath();
    for (let row = rows.start; row < rows.end; row += 1) {
      const y =
        this.headerHeight + this.rowAxis.offset(row + 1) - this.scrollY - 0.5;
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    for (let col = columns.start; col < columns.end; col += 1) {
      const x = this.columnAxis.offset(col + 1) - this.scrollX - 0.5;
      context.moveTo(x, this.headerHeight);
      context.lineTo(x, height);
    }
    context.stroke();

    if (this.rowAxis.count === 0) {
      context.fillStyle = COLORS.emptyText;
      context.font = `13px ${FONT_STACK}`;
      context.textAlign = 'center';
      context.fillText('暂无记录', width / 2, height / 2);
      context.textAlign = 'start';
    }
    context.restore();
  }

  private drawContent(
    width: number,
    height: number,
    rows: VisibleRange,
    columns: VisibleRange,
  ): void {
    const offscreenActive = this.offscreen !== null && this.offscreenContext !== null;

    if (offscreenActive) {
      const pixelWidth = Math.max(1, Math.round(width * this.dpr));
      const pixelHeight = Math.max(1, Math.round(height * this.dpr));
      if (this.offscreen!.width !== pixelWidth) {
        this.offscreen!.width = pixelWidth;
      }
      if (this.offscreen!.height !== pixelHeight) {
        this.offscreen!.height = pixelHeight;
      }
      this.prepareContext(this.offscreenContext!, width, height, true);
    }

    const target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D =
      offscreenActive ? this.offscreenContext! : this.contexts.content;

    if (!offscreenActive) {
      this.prepareContext(this.contexts.content, width, height, true);
    }

    target.save();
    target.beginPath();
    target.rect(0, this.headerHeight, width, height - this.headerHeight);
    target.clip();
    target.font = `13px ${FONT_STACK}`;
    target.textBaseline = 'middle';

    for (let row = rows.start; row < rows.end; row += 1) {
      const y =
        this.headerHeight + this.rowAxis.offset(row) - this.scrollY;
      const rowHeight = this.rowAxis.size(row);
      if (y + rowHeight < this.headerHeight || y > height) continue;

      for (let col = columns.start; col < columns.end; col += 1) {
        const cell = this.getCell(row, col);
        if (!cell || cell.text === '') continue;

        const x = this.columnAxis.offset(col) - this.scrollX;
        const columnWidth = this.columnAxis.size(col);
        if (x + columnWidth < 0 || x > width) continue;

        target.save();
        target.beginPath();
        target.rect(x + 1, y, columnWidth - 2, rowHeight);
        target.clip();

        if (cell.pill) {
          const textWidth = target.measureText(cell.text).width;
          const pillWidth = Math.min(columnWidth - 16, textWidth + 20);
          const pillHeight = 22;
          const pillX = x + 10;
          const pillY = y + (rowHeight - pillHeight) / 2;
          target.fillStyle = cell.bg ?? '#e8f3ff';
          target.beginPath();
          target.roundRect(pillX, pillY, pillWidth, pillHeight, 11);
          target.fill();
          target.fillStyle = cell.color ?? '#1f2329';
          target.fillText(cell.text, pillX + 10, y + rowHeight / 2);
        } else {
          if (cell.bold) {
            target.font = `600 13px ${FONT_STACK}`;
          }
          target.fillStyle = cell.color ?? COLORS.cellText;
          target.fillText(cell.text, x + 12, y + rowHeight / 2);
          if (cell.bold) {
            target.font = `13px ${FONT_STACK}`;
          }
        }
        target.restore();
      }
    }
    target.restore();

    if (offscreenActive) {
      const content = this.contexts.content;
      content.setTransform(1, 0, 0, 1, 0, 0);
      content.clearRect(0, 0, width * this.dpr, height * this.dpr);
      content.drawImage(this.offscreen!, 0, 0, width, height);
    }
  }

  private drawSelection(width: number, height: number): void {
    const context = this.contexts.selection;
    this.prepareContext(context, width, height, true);

    if (!this.selection) return;
    const { row, col } = this.selection;
    if (row >= this.rowAxis.count || col >= this.columns.length) return;

    const rect = this.cellRect(row, col);
    if (rect.y + rect.height < this.headerHeight) return;

    context.save();
    context.beginPath();
    context.rect(0, this.headerHeight, width, height - this.headerHeight);
    context.clip();

    context.fillStyle = COLORS.selectionFill;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = COLORS.selectionBorder;
    context.lineWidth = 2;
    context.strokeRect(
      rect.x + 1,
      rect.y + 1,
      Math.max(0, rect.width - 2),
      Math.max(0, rect.height - 2),
    );
    context.restore();
  }
}
