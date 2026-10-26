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
  /** Short glyph drawn before the header label (WeCom field-type cue). */
  icon?: string;
}

export interface CellRender {
  text: string;
  bg?: string;
  color?: string;
  bold?: boolean;
  /** Draw as a rounded status pill (select/status fields). */
  pill?: boolean;
  /** Thumbnail URL for image fields (drawn from a local cache). */
  image?: string;
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

/** WeCom `WordMeasurer`: fontKey → word → width. Cleared when font changes. */
const measureCache = new Map<string, Map<string, number>>();

function measureCached(
  target: Pick<CanvasRenderingContext2D, 'measureText' | 'font'>,
  text: string,
): number {
  const fontKey = target.font || '';
  let byWord = measureCache.get(fontKey);
  if (!byWord) {
    byWord = new Map();
    measureCache.set(fontKey, byWord);
  }
  const hit = byWord.get(text);
  if (hit !== undefined) return hit;
  const width = target.measureText(text).width;
  byWord.set(text, width);
  return width;
}

/**
 * WeCom sdk_1 `appendEllipsis`: binary-search the longest prefix whose
 * measured width plus "…" fits in the cell. Keeps paint O(log n) measures.
 */
type TextMeasureCtx = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>;

export function truncateToWidth(
  target: TextMeasureCtx,
  text: string,
  maxWidth: number,
): string {
  if (!text || maxWidth <= 0) return '';
  if (measureCached(target, text) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisWidth = measureCached(target, ellipsis);
  if (ellipsisWidth > maxWidth) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const width = measureCached(target, text.slice(0, mid)) + ellipsisWidth;
    if (width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ellipsis : `${text.slice(0, lo)}${ellipsis}`;
}

/**
 * WeCom sdk_1 `breakLine`: greedy pack tokens into lines up to maxWidth /
 * maxLineCount, then ellipsis the last line if truncated.
 */
export function breakLine(
  target: TextMeasureCtx,
  text: string,
  maxWidth: number,
  maxLineCount: number,
): string[] {
  if (!text || maxWidth <= 0 || maxLineCount <= 0) return [];
  const tokens = text.split(/(\s+)/).filter((token) => token.length > 0);
  const lines: string[] = [];
  let current = '';

  const pushLine = (line: string, isLast: boolean) => {
    if (isLast && measureCached(target, line) > maxWidth) {
      lines.push(truncateToWidth(target, line, maxWidth));
    } else {
      lines.push(line);
    }
  };

  for (const token of tokens) {
    const candidate = current + token;
    if (!current || measureCached(target, candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length + 1 >= maxLineCount) {
      pushLine(current + token, true);
      return lines;
    }
    pushLine(current, false);
    current = token.trimStart();
  }
  if (current) {
    const last = lines.length + 1 >= maxLineCount;
    pushLine(current, last || measureCached(target, current) > maxWidth);
  }
  return lines.slice(0, maxLineCount);
}

export interface CanvasGridOptions {
  columns: GridColumn[];
  rowCount: number;
  rowHeight?: number;
  headerHeight?: number;
  overscan?: number;
  getCell?: (row: number, col: number) => CellRender | null;
  getRowColor?: (row: number) => string | null;
  /** Sticky canvas footer label per column（企微：记录数 / 求和）. */
  getColumnFooter?: (col: number) => string | null;
  onSelectionChange?: (selection: Selection | null) => void;
  onCellClick?: (selection: Selection) => void;
  onCellDoubleClick?: (selection: Selection) => void;
  onViewportChange?: (stats: GridStats) => void;
  onColumnResize?: (columnIndex: number, width: number) => void;
  /** Fired when a data column header is clicked (not resize / add). */
  onHeaderClick?: (
    columnIndex: number,
    anchor: { top: number; left: number },
  ) => void;
  /** Row-number click; modifiers allow WeCom-style shift/ctrl multi-select. */
  onRowNumberClick?: (
    row: number,
    modifiers: { shift: boolean; meta: boolean },
  ) => void;
  /** Fired when the trailing "+" header (id `__add_field__`) is clicked. */
  onAddColumnClick?: (anchor: { top: number; left: number }) => void;
  /** 企微底栏行号区「+」：打开向上/向下插入菜单。 */
  onFooterAddClick?: (anchor: { top: number; left: number }) => void;
  /** 行号右键：打开向上/向下插入菜单（相对该行）。 */
  onRowInsertMenu?: (
    row: number,
    anchor: { top: number; left: number },
  ) => void;
  /** 单元格右键：删除行/列、插入行/列。 */
  onCellContextMenu?: (
    selection: Selection,
    anchor: { top: number; left: number },
  ) => void;
  /**
   * Drag the selection fill-handle (bottom-right square) to extend a value
   * across rows in the same column — WeCom / spreadsheet fill gesture.
   */
  onFillExtend?: (payload: {
    col: number;
    fromRow: number;
    toRow: number;
  }) => void;
  /** Left sticky row-number gutter width; 0 disables. */
  rowGutterWidth?: number;
  /** Leading data columns that stay fixed during horizontal scroll. */
  freezeColumnCount?: number;
  offscreenFactory?: () => OffscreenCanvas | null;
}

export const ADD_FIELD_COLUMN_ID = '__add_field__';
const DEFAULT_ROW_GUTTER = 48;

type LayerName = 'grid' | 'content' | 'selection';

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

const COLORS = {
  /** 表格外右侧空白（企微：+ 列之后不再画表头/底栏/竖线）。 */
  page: '#f5f6f8',
  background: '#ffffff',
  headerBackground: '#f7f7f8',
  border: '#e5e6eb',
  headerText: '#646a73',
  cellText: '#1f2329',
  selectionFill: 'rgba(45, 140, 240, 0.08)',
  selectionBorder: '#2d8cf0',
  emptyText: '#c0c4cc',
};

const HEADER_HEIGHT = 40;
/** 企微底栏两行文案（标题 + 数值），略高于单行。 */
const FOOTER_HEIGHT = 40;
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
  private readonly rowGutterWidth: number;
  private frozenColumnCount = 0;
  private readonly offscreen: OffscreenCanvas | null;
  private readonly offscreenContext: OffscreenCanvasRenderingContext2D | null;

  private rowAxis: UniformAxis;
  private columnAxis: AxisLayout;
  private columnWidths: number[];
  private getCell: (row: number, col: number) => CellRender | null;
  private getRowColor: (row: number) => string | null;
  private getColumnFooter: (col: number) => string | null;
  private selection: Selection | null = null;
  private selectedRows = new Set<number>();
  private readonly imageCache = new Map<
    string,
    { status: 'loading' | 'loaded' | 'error'; image?: HTMLImageElement }
  >();
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
  private fillState: {
    col: number;
    fromRow: number;
    toRow: number;
  } | null = null;
  private static readonly FILL_HANDLE_SIZE = 8;

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
    this.rowGutterWidth = Math.max(
      0,
      options.rowGutterWidth ?? DEFAULT_ROW_GUTTER,
    );
    this.frozenColumnCount = Math.max(0, options.freezeColumnCount ?? 0);
    this.getCell = options.getCell ?? (() => null);
    this.getRowColor = options.getRowColor ?? (() => null);
    this.getColumnFooter = options.getColumnFooter ?? (() => null);

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
    this.clampFrozenColumnCount();

    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('dblclick', this.onDoubleClick);
    host.addEventListener('contextmenu', this.onContextMenu);
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

  setSelectedRows(rows: number[]): void {
    this.selectedRows = new Set(rows);
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
    this.clampFrozenColumnCount();
    this.updateSpacer();
    this.invalidate();
  }

  setFreezeColumnCount(count: number): void {
    this.frozenColumnCount = Math.max(0, Math.floor(count));
    this.clampFrozenColumnCount();
    this.invalidate();
  }

  setCellProvider(
    provider: (row: number, col: number) => CellRender | null,
  ): void {
    this.getCell = provider;
    this.invalidate();
  }

  setColumnFooterProvider(
    provider: (col: number) => string | null,
  ): void {
    this.getColumnFooter = provider;
    this.invalidate();
  }

  private footerHeight(): number {
    return FOOTER_HEIGHT;
  }

  /**
   * 企微：行少时底栏紧贴末行；行多超出视口时粘在底部。
   * 勿始终 `height - footerH`，否则中间会空出一大块「假表格」。
   */
  private footerTop(height: number): number {
    const footerH = this.footerHeight();
    const contentBottom =
      this.headerHeight + this.rowAxis.totalSize - this.scrollY;
    return Math.min(
      Math.max(contentBottom, this.headerHeight),
      Math.max(this.headerHeight, height - footerH),
    );
  }

  ensureCellVisible(row: number, col: number): void {
    const headerHeight = this.headerHeight;
    const top = this.rowAxis.offset(row);
    const bottom = top + this.rowAxis.size(row);
    const scrollTop = this.scroller.scrollTop;
    const viewportHeight = Math.max(
      0,
      this.footerTop(this.host.clientHeight) - headerHeight,
    );

    if (top < scrollTop) {
      this.scroller.scrollTop = top;
    } else if (bottom > scrollTop + viewportHeight) {
      this.scroller.scrollTop = bottom - viewportHeight;
    }

    if (col >= this.frozenColumnCount) {
      const frozenW = this.frozenWidth();
      const left = this.columnAxis.offset(col);
      const right = left + this.columnAxis.size(col);
      const scrollLeft = this.scroller.scrollLeft;
      const viewportWidth = Math.max(
        0,
        this.host.clientWidth - this.rowGutterWidth - frozenW,
      );

      if (left < scrollLeft + frozenW) {
        this.scroller.scrollLeft = Math.max(0, left - frozenW);
      } else if (right > scrollLeft + frozenW + viewportWidth) {
        this.scroller.scrollLeft = right - frozenW - viewportWidth;
      }
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
      x: this.columnScreenX(col),
      y: this.headerHeight + this.rowAxis.offset(row) - this.scrollY,
      width: this.columnAxis.size(col),
      height: this.rowAxis.size(row),
    };
  }

  private clampFrozenColumnCount(): void {
    const maxFreezeable = this.columns.filter(
      (column) => column.id !== ADD_FIELD_COLUMN_ID,
    ).length;
    this.frozenColumnCount = Math.min(this.frozenColumnCount, maxFreezeable);
  }

  private frozenWidth(): number {
    if (this.frozenColumnCount <= 0) return 0;
    return this.columnAxis.offset(
      Math.min(this.frozenColumnCount, this.columns.length),
    );
  }

  private columnScreenX(col: number): number {
    const base = this.rowGutterWidth + this.columnAxis.offset(col);
    if (col < this.frozenColumnCount) return base;
    return base - this.scrollX;
  }

  private columnIndexAtScreenX(screenX: number): number {
    const local = screenX - this.rowGutterWidth;
    if (local < 0) return -1;
    const frozenW = this.frozenWidth();
    if (local < frozenW) {
      return this.columnAxis.indexAt(local);
    }
    return this.columnAxis.indexAt(local + this.scrollX);
  }

  private contentViewportWidth(width: number): number {
    return Math.max(0, width - this.rowGutterWidth);
  }

  /**
   * 表格内容右缘（含「+」加列）：屏幕坐标。右侧留白不画成假列。
   */
  private tableRight(width: number): number {
    const edge =
      this.rowGutterWidth + this.columnAxis.totalSize - this.scrollX;
    return Math.min(width, Math.max(this.rowGutterWidth, edge));
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

    const bodyHeight = Math.max(
      0,
      this.footerTop(height) - this.headerHeight,
    );
    const rows = computeVisibleRange(
      this.rowAxis,
      this.scrollY,
      bodyHeight,
      this.overscan,
    );
    const scrollColumns = computeVisibleRange(
      this.columnAxis,
      this.scrollX,
      this.contentViewportWidth(width),
      this.overscan,
    );
    const bodyColumnStart = Math.max(
      this.frozenColumnCount,
      scrollColumns.start,
    );
    const columns: VisibleRange = {
      start: this.frozenColumnCount > 0 ? 0 : scrollColumns.start,
      end: scrollColumns.end,
    };

    this.drawGrid(width, height, rows, columns, bodyColumnStart);
    this.drawContent(width, height, rows, columns, bodyColumnStart);
    this.drawSelection(width, height);
    this.drawFooter(width, height, columns, bodyColumnStart);

    this.stats = {
      cellsDrawn:
        Math.max(0, rows.end - rows.start) *
        (this.frozenColumnCount +
          Math.max(0, scrollColumns.end - bodyColumnStart)),
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
    this.host.removeEventListener('contextmenu', this.onContextMenu);
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

  private readonly onContextMenu = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    if (point.y < this.headerHeight) return;
    if (point.y >= this.footerTop(this.host.clientHeight)) return;

    const rect = this.host.getBoundingClientRect();

    // 行号区：插入行菜单
    if (point.x < this.rowGutterWidth) {
      const row = this.rowAxis.indexAt(
        point.y - this.headerHeight + this.scrollY,
      );
      if (row < 0 || row >= this.rowAxis.count) return;
      event.preventDefault();
      this.options.onRowInsertMenu?.(row, {
        top: rect.top + point.y,
        left: rect.left + this.rowGutterWidth + 4,
      });
      return;
    }

    // 单元格区：完整右键菜单
    const row = this.rowAxis.indexAt(
      point.y - this.headerHeight + this.scrollY,
    );
    const col = this.columnIndexAtScreenX(point.x);
    if (
      row < 0 ||
      row >= this.rowAxis.count ||
      col < 0 ||
      col >= this.columns.length
    ) {
      return;
    }
    if (this.columns[col]?.id === ADD_FIELD_COLUMN_ID) return;
    event.preventDefault();
    this.selection = { row, col };
    this.options.onSelectionChange?.(this.selection);
    this.options.onCellContextMenu?.(this.selection, {
      top: rect.top + point.y,
      left: rect.left + point.x,
    });
    this.invalidate();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = this.localPoint(event);
    if (point.x > this.host.clientWidth || point.y > this.host.clientHeight) {
      return;
    }
    const footerY = this.footerTop(this.host.clientHeight);
    // 底栏行号区「+」：添加一行（与工具栏同功能）
    if (point.y >= footerY) {
      if (point.x < this.rowGutterWidth && this.options.onFooterAddClick) {
        event.preventDefault();
        const rect = this.host.getBoundingClientRect();
        this.options.onFooterAddClick({
          top: rect.top + footerY,
          left: rect.left + 4,
        });
      }
      return;
    }

    if (point.x < this.rowGutterWidth) {
      if (point.y >= this.headerHeight) {
        const row = this.rowAxis.indexAt(
          point.y - this.headerHeight + this.scrollY,
        );
        if (row >= 0 && row < this.rowAxis.count) {
          this.options.onRowNumberClick?.(row, {
            shift: event.shiftKey,
            meta: event.metaKey || event.ctrlKey,
          });
        }
      }
      return;
    }

    if (point.y < this.headerHeight) {
      const col = this.columnIndexAtScreenX(point.x);
      const column = this.columns[col];
      if (column?.id === ADD_FIELD_COLUMN_ID) {
        const rect = this.host.getBoundingClientRect();
        const x = this.columnScreenX(col);
        this.options.onAddColumnClick?.({
          top: rect.top + this.headerHeight + 4,
          left: rect.left + x,
        });
        return;
      }
      const boundary = this.columnBoundaryAtScreenX(point.x);
      if (boundary !== null) {
        const boundaryCol = this.columns[boundary];
        if (boundaryCol?.id === ADD_FIELD_COLUMN_ID) return;
        this.startResize(boundary, event);
        return;
      }
      if (col >= 0 && col < this.columns.length) {
        const rect = this.host.getBoundingClientRect();
        this.options.onHeaderClick?.(col, {
          top: rect.top + this.headerHeight + 4,
          left: rect.left + this.columnScreenX(col),
        });
      }
      return;
    }

    if (this.hitFillHandle(point) && this.selection) {
      this.fillState = {
        col: this.selection.col,
        fromRow: this.selection.row,
        toRow: this.selection.row,
      };
      this.host.style.cursor = 'crosshair';
      event.preventDefault();
      this.invalidate();
      return;
    }

    const row = this.rowAxis.indexAt(point.y - this.headerHeight + this.scrollY);
    const col = this.columnIndexAtScreenX(point.x);
    if (
      row < 0 ||
      row >= this.rowAxis.count ||
      col < 0 ||
      col >= this.columns.length
    ) {
      return;
    }
    if (this.columns[col]?.id === ADD_FIELD_COLUMN_ID) return;

    this.selection = { row, col };
    this.options.onSelectionChange?.(this.selection);
    this.options.onCellClick?.(this.selection);
    this.invalidate();
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const point = this.localPoint(event);
    if (point.y < this.headerHeight || point.x < this.rowGutterWidth) return;

    const row = this.rowAxis.indexAt(point.y - this.headerHeight + this.scrollY);
    const col = this.columnIndexAtScreenX(point.x);
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
    if (this.fillState) {
      const point = this.localPoint(event);
      const row = this.rowAxis.indexAt(
        point.y - this.headerHeight + this.scrollY,
      );
      if (row >= 0 && row < this.rowAxis.count) {
        this.fillState = { ...this.fillState, toRow: row };
        this.invalidate();
      }
      return;
    }
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
    if (this.fillState) {
      const { col, fromRow, toRow } = this.fillState;
      this.fillState = null;
      this.host.style.cursor = '';
      if (toRow !== fromRow) {
        this.options.onFillExtend?.({ col, fromRow, toRow });
      }
      this.invalidate();
      return;
    }
    if (!this.resizeState) return;
    const { col } = this.resizeState;
    this.resizeState = null;
    this.host.style.cursor = '';
    this.options.onColumnResize?.(col, this.columnWidths[col]);
  };

  private hitFillHandle(point: { x: number; y: number }): boolean {
    if (!this.selection || !this.options.onFillExtend) return false;
    const handle = this.fillHandleRect();
    if (!handle) return false;
    return (
      point.x >= handle.x &&
      point.x <= handle.x + handle.size &&
      point.y >= handle.y &&
      point.y <= handle.y + handle.size
    );
  }

  private fillHandleRect(): { x: number; y: number; size: number } | null {
    if (!this.selection) return null;
    const rect = this.cellRect(this.selection.row, this.selection.col);
    const size = CanvasGridEngine.FILL_HANDLE_SIZE;
    return {
      x: rect.x + rect.width - size / 2,
      y: rect.y + rect.height - size / 2,
      size,
    };
  }

  private columnBoundaryAtScreenX(screenX: number): number | null {
    for (let i = 0; i < this.columnWidths.length; i += 1) {
      const boundaryX = this.columnScreenX(i) + this.columnAxis.size(i);
      if (Math.abs(boundaryX - screenX) <= RESIZE_HIT_WIDTH) return i;
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

  private drawColumnHeader(
    context: CanvasRenderingContext2D,
    col: number,
  ): void {
    const column = this.columns[col];
    if (!column) return;
    const x = this.columnScreenX(col);
    const columnWidth = this.columnAxis.size(col);
    const gutter = this.rowGutterWidth;
    if (x + columnWidth < gutter || x > this.host.clientWidth) return;

    context.save();
    context.beginPath();
    context.rect(x, 0, columnWidth, this.headerHeight);
    context.clip();
    if (column.id === ADD_FIELD_COLUMN_ID) {
      context.fillStyle = COLORS.selectionBorder;
      context.font = `600 16px ${FONT_STACK}`;
      context.textAlign = 'center';
      context.fillText('+', x + columnWidth / 2, this.headerHeight / 2);
      context.textAlign = 'start';
      context.fillStyle = COLORS.headerText;
      context.font = `600 12px ${FONT_STACK}`;
    } else {
      let textX = x + 12;
      if (column.icon) {
        context.fillStyle = COLORS.emptyText;
        context.fillText(column.icon, x + 10, this.headerHeight / 2);
        textX = x + 28;
        context.fillStyle = COLORS.headerText;
      }
      context.fillText(column.name, textX, this.headerHeight / 2);
    }
    context.restore();
  }

  private drawGrid(
    width: number,
    height: number,
    rows: VisibleRange,
    columns: VisibleRange,
    bodyColumnStart: number,
  ): void {
    const context = this.contexts.grid;
    this.prepareContext(context, width, height, true);
    const gutter = this.rowGutterWidth;
    const frozenW = this.frozenWidth();
    const scrollLeft = gutter + frozenW;
    const tableRight = this.tableRight(width);
    const tableWidth = Math.max(0, tableRight);
    const bodyBottom = this.footerTop(height);
    const tableBottom = Math.min(
      height,
      bodyBottom + this.footerHeight(),
    );

    // 整屏底色；表格本体只画到最后一列右缘，右侧 / 表下保持空白。
    context.fillStyle = COLORS.page;
    context.fillRect(0, 0, width, height);
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, tableWidth, tableBottom);

    context.fillStyle = COLORS.headerBackground;
    context.fillRect(0, 0, tableWidth, this.headerHeight);
    context.strokeStyle = COLORS.border;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, this.headerHeight - 0.5);
    context.lineTo(tableWidth, this.headerHeight - 0.5);
    context.stroke();

    context.font = `600 12px ${FONT_STACK}`;
    context.textBaseline = 'middle';
    context.fillStyle = COLORS.headerText;

    // Scrolling headers (clipped so they slide under the freeze pane).
    context.save();
    context.beginPath();
    context.rect(
      scrollLeft,
      0,
      Math.max(0, tableRight - scrollLeft),
      this.headerHeight,
    );
    context.clip();
    for (let col = bodyColumnStart; col < columns.end; col += 1) {
      this.drawColumnHeader(context, col);
    }
    context.restore();

    // Frozen headers drawn on top.
    if (this.frozenColumnCount > 0) {
      context.save();
      context.beginPath();
      context.rect(gutter, 0, frozenW, this.headerHeight);
      context.clip();
      context.fillStyle = COLORS.headerBackground;
      context.fillRect(gutter, 0, frozenW, this.headerHeight);
      context.fillStyle = COLORS.headerText;
      for (let col = 0; col < this.frozenColumnCount; col += 1) {
        this.drawColumnHeader(context, col);
      }
      context.restore();
    }

    // Body ends at footer top — 行少时紧贴末行，不在中间灌空行线。
    const bodyH = Math.max(0, bodyBottom - this.headerHeight);
    context.save();
    context.beginPath();
    context.rect(
      scrollLeft,
      this.headerHeight,
      Math.max(0, tableRight - scrollLeft),
      bodyH,
    );
    context.clip();

    context.strokeStyle = COLORS.border;
    context.beginPath();
    for (let row = rows.start; row < rows.end; row += 1) {
      const y =
        this.headerHeight + this.rowAxis.offset(row + 1) - this.scrollY - 0.5;
      if (y < this.headerHeight || y > bodyBottom) continue;
      context.moveTo(scrollLeft, y);
      context.lineTo(tableRight, y);
    }
    for (let col = bodyColumnStart; col < columns.end; col += 1) {
      const x = this.columnScreenX(col + 1) - 0.5;
      if (x > tableRight) continue;
      context.moveTo(x, this.headerHeight);
      context.lineTo(x, bodyBottom);
    }
    if (tableRight < width) {
      context.moveTo(tableRight - 0.5, 0);
      context.lineTo(tableRight - 0.5, bodyBottom);
    }
    context.stroke();

    if (this.rowAxis.count === 0) {
      const dataColumns = this.columns.filter(
        (column) => column.id !== ADD_FIELD_COLUMN_ID,
      );
      context.fillStyle = COLORS.emptyText;
      context.font = `13px ${FONT_STACK}`;
      context.textAlign = 'center';
      context.fillText(
        dataColumns.length === 0
          ? '点击「+ 添加字段」开始建表'
          : '暂无记录，点击「+ 添加一行」',
        scrollLeft + Math.max(0, tableRight - scrollLeft) / 2,
        this.headerHeight + this.rowHeight * 2,
      );
      context.textAlign = 'start';
    }
    context.restore();

    if (this.frozenColumnCount > 0) {
      context.save();
      context.beginPath();
      context.rect(gutter, this.headerHeight, frozenW, bodyH);
      context.clip();
      context.fillStyle = COLORS.background;
      context.fillRect(gutter, this.headerHeight, frozenW, bodyH);
      context.strokeStyle = COLORS.border;
      context.beginPath();
      for (let row = rows.start; row < rows.end; row += 1) {
        const y =
          this.headerHeight + this.rowAxis.offset(row + 1) - this.scrollY - 0.5;
        if (y < this.headerHeight || y > bodyBottom) continue;
        context.moveTo(gutter, y);
        context.lineTo(gutter + frozenW, y);
      }
      for (let col = 0; col < this.frozenColumnCount; col += 1) {
        const x = this.columnScreenX(col + 1) - 0.5;
        context.moveTo(x, this.headerHeight);
        context.lineTo(x, bodyBottom);
      }
      context.stroke();
      context.restore();

      context.strokeStyle = COLORS.border;
      context.beginPath();
      context.moveTo(gutter + frozenW - 0.5, 0);
      context.lineTo(gutter + frozenW - 0.5, bodyBottom);
      context.stroke();
    }

    this.drawRowGutter(context, width, height, rows);
  }

  private drawRowGutter(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    rows: VisibleRange,
  ): void {
    const gutter = this.rowGutterWidth;
    if (gutter <= 0) return;

    const bodyBottom = this.footerTop(height);
    context.fillStyle = COLORS.headerBackground;
    context.fillRect(0, 0, gutter, bodyBottom);
    context.strokeStyle = COLORS.border;
    context.beginPath();
    context.moveTo(gutter - 0.5, 0);
    context.lineTo(gutter - 0.5, bodyBottom);
    context.moveTo(0, this.headerHeight - 0.5);
    context.lineTo(gutter, this.headerHeight - 0.5);
    context.stroke();

    context.save();
    context.beginPath();
    context.rect(0, this.headerHeight, gutter, Math.max(0, bodyBottom - this.headerHeight));
    context.clip();

    context.fillStyle = COLORS.emptyText;
    context.font = `12px ${FONT_STACK}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let row = rows.start; row < rows.end; row += 1) {
      const y =
        this.headerHeight + this.rowAxis.offset(row) - this.scrollY;
      const rowHeight = this.rowAxis.size(row);
      if (y + rowHeight < this.headerHeight || y > bodyBottom) continue;
      if (this.selectedRows.has(row)) {
        context.fillStyle = '#e8f3ff';
        context.fillRect(1, y, gutter - 1, rowHeight);
        context.fillStyle = COLORS.selectionBorder;
        context.font = `600 12px ${FONT_STACK}`;
      } else {
        context.fillStyle = COLORS.emptyText;
        context.font = `12px ${FONT_STACK}`;
      }
      context.fillText(String(row + 1), gutter / 2, y + rowHeight / 2);
      context.beginPath();
      context.moveTo(0, y + rowHeight - 0.5);
      context.lineTo(gutter, y + rowHeight - 0.5);
      context.stroke();
    }
    context.restore();
    context.textAlign = 'start';
  }

  private paintCellContent(
    target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    row: number,
    col: number,
    y: number,
    rowHeight: number,
    width: number,
  ): void {
    const cell = this.getCell(row, col);
    if (!cell || (!cell.text && !cell.image)) return;

    const gutter = this.rowGutterWidth;
    const x = this.columnScreenX(col);
    const columnWidth = this.columnAxis.size(col);
    if (x + columnWidth < gutter || x > width) return;

    target.save();
    target.beginPath();
    target.rect(x + 1, y, columnWidth - 2, rowHeight);
    target.clip();

    if (cell.image) {
      const image = this.imageFor(cell.image);
      const size = Math.max(16, rowHeight - 8);
      if (image) {
        target.drawImage(image, x + 6, y + 4, size, size);
      } else {
        target.fillStyle = '#f2f3f5';
        target.fillRect(x + 6, y + 4, size, size);
        target.fillStyle = COLORS.emptyText;
        target.font = `11px ${FONT_STACK}`;
        target.fillText('图片', x + 9, y + rowHeight / 2);
      }
      if (cell.text) {
        target.fillStyle = cell.color ?? COLORS.cellText;
        target.font = `12px ${FONT_STACK}`;
        const label = truncateToWidth(
          target,
          cell.text,
          Math.max(0, columnWidth - size - 24),
        );
        target.fillText(label, x + size + 12, y + rowHeight / 2);
      }
    } else if (cell.pill) {
      target.font = `600 12px ${FONT_STACK}`;
      const textWidth = target.measureText(cell.text).width;
      const pillWidth = Math.min(columnWidth - 16, textWidth + 22);
      const pillHeight = 22;
      const pillX = x + 10;
      const pillY = y + (rowHeight - pillHeight) / 2;
      target.fillStyle = cell.bg ?? '#e8f3ff';
      target.beginPath();
      target.roundRect(pillX, pillY, pillWidth, pillHeight, 11);
      target.fill();
      target.fillStyle = cell.color ?? '#1f2329';
      const label = truncateToWidth(
        target,
        cell.text,
        Math.max(0, pillWidth - 16),
      );
      target.fillText(label, pillX + 11, y + rowHeight / 2);
      target.font = `13px ${FONT_STACK}`;
    } else {
      if (cell.bold) {
        target.font = `600 13px ${FONT_STACK}`;
      }
      target.fillStyle = cell.color ?? COLORS.cellText;
      const maxWidth = Math.max(0, columnWidth - 24);
      const lineHeight = 16;
      const maxLines = Math.max(1, Math.floor((rowHeight - 8) / lineHeight));
      if (maxLines <= 1) {
        const label = truncateToWidth(target, cell.text, maxWidth);
        target.fillText(label, x + 12, y + rowHeight / 2);
      } else {
        const lines = breakLine(target, cell.text, maxWidth, maxLines);
        const blockHeight = lines.length * lineHeight;
        let textY = y + (rowHeight - blockHeight) / 2 + lineHeight / 2;
        target.textBaseline = 'middle';
        for (const line of lines) {
          target.fillText(line, x + 12, textY);
          textY += lineHeight;
        }
      }
      if (cell.bold) {
        target.font = `13px ${FONT_STACK}`;
      }
    }
    target.restore();
  }

  private drawContent(
    width: number,
    height: number,
    rows: VisibleRange,
    columns: VisibleRange,
    bodyColumnStart: number,
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

    const gutter = this.rowGutterWidth;
    const frozenW = this.frozenWidth();
    const scrollLeft = gutter + frozenW;
    const tableRight = this.tableRight(width);

    const paintRows = (
      clipX: number,
      clipW: number,
      colStart: number,
      colEnd: number,
      fillBg: boolean,
    ) => {
      target.save();
      target.beginPath();
      const bodyH = Math.max(0, this.footerTop(height) - this.headerHeight);
      target.rect(clipX, this.headerHeight, Math.max(0, clipW), bodyH);
      target.clip();
      if (fillBg) {
        target.fillStyle = COLORS.background;
        target.fillRect(clipX, this.headerHeight, Math.max(0, clipW), bodyH);
      }
      target.font = `13px ${FONT_STACK}`;
      target.textBaseline = 'middle';

      for (let row = rows.start; row < rows.end; row += 1) {
        const y =
          this.headerHeight + this.rowAxis.offset(row) - this.scrollY;
        const rowHeight = this.rowAxis.size(row);
        if (y + rowHeight < this.headerHeight || y > height) continue;

        if (this.selectedRows.has(row)) {
          target.fillStyle = COLORS.selectionFill;
          target.fillRect(clipX, y, Math.max(0, clipW), rowHeight);
        }
        const rowColor = this.getRowColor(row);
        if (rowColor) {
          target.fillStyle = rowColor;
          target.fillRect(clipX, y, Math.max(0, clipW), rowHeight);
        }

        for (let col = colStart; col < colEnd; col += 1) {
          this.paintCellContent(target, row, col, y, rowHeight, width);
        }
      }
      target.restore();
    };

    paintRows(
      scrollLeft,
      Math.max(0, tableRight - scrollLeft),
      bodyColumnStart,
      columns.end,
      false,
    );
    if (this.frozenColumnCount > 0) {
      paintRows(gutter, frozenW, 0, this.frozenColumnCount, true);
    }

    if (offscreenActive) {
      // Offscreen 已按 device pixel 尺寸绘制；回贴必须 1:1，不能用 CSS 像素宽高，
      // 否则在 dpr>1 时内容缩到左上角，单元格看起来「改了不显示」。
      const content = this.contexts.content;
      const pixelW = this.offscreen!.width;
      const pixelH = this.offscreen!.height;
      content.setTransform(1, 0, 0, 1, 0, 0);
      content.clearRect(0, 0, pixelW, pixelH);
      content.drawImage(this.offscreen!, 0, 0);
    }
  }

  private imageFor(url: string): HTMLImageElement | null {
    const cached = this.imageCache.get(url);
    if (cached) return cached.status === 'loaded' ? cached.image ?? null : null;
    this.imageCache.set(url, { status: 'loading' });
    if (typeof Image === 'undefined') {
      this.imageCache.set(url, { status: 'error' });
      return null;
    }
    const image = new Image();
    image.onload = () => {
      this.imageCache.set(url, { status: 'loaded', image });
      this.invalidate();
    };
    image.onerror = () => this.imageCache.set(url, { status: 'error' });
    image.src = url;
    return null;
  }

  /** 企微底栏：贴末行（或粘视口底）；文案两行「标题 / 数值」。 */
  private drawFooter(
    width: number,
    height: number,
    columns: VisibleRange,
    bodyColumnStart: number,
  ): void {
    const footerH = this.footerHeight();
    if (footerH <= 0) return;
    const y = this.footerTop(height);
    const footerBottom = y + footerH;
    const gutter = this.rowGutterWidth;
    const frozenW = this.frozenWidth();

    const paintOn = (context: CanvasRenderingContext2D) => {
      context.save();
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const tableRight = this.tableRight(width);

      context.fillStyle = COLORS.headerBackground;
      context.fillRect(0, y, tableRight, footerH);
      context.strokeStyle = COLORS.border;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(tableRight, y + 0.5);
      context.moveTo(0, footerBottom - 0.5);
      context.lineTo(tableRight, footerBottom - 0.5);
      if (tableRight < width) {
        context.moveTo(tableRight - 0.5, y);
        context.lineTo(tableRight - 0.5, footerBottom);
      }
      context.stroke();

      context.beginPath();
      if (gutter > 0) {
        context.moveTo(gutter - 0.5, y);
        context.lineTo(gutter - 0.5, footerBottom);
      }
      for (let col = bodyColumnStart; col < columns.end; col += 1) {
        const x = this.columnScreenX(col + 1) - 0.5;
        if (x < gutter || x > tableRight) continue;
        context.moveTo(x, y);
        context.lineTo(x, footerBottom);
      }
      if (this.frozenColumnCount > 0) {
        for (let col = 0; col < this.frozenColumnCount; col += 1) {
          const x = this.columnScreenX(col + 1) - 0.5;
          context.moveTo(x, y);
          context.lineTo(x, footerBottom);
        }
        context.moveTo(gutter + frozenW - 0.5, y);
        context.lineTo(gutter + frozenW - 0.5, footerBottom);
      }
      context.stroke();

      // 企微：底栏左侧「+」
      if (gutter > 0) {
        context.fillStyle = COLORS.headerText;
        context.font = `600 18px ${FONT_STACK}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('+', gutter / 2, y + footerH / 2);
        context.textAlign = 'start';
      }

      context.fillStyle = COLORS.emptyText;
      context.textAlign = 'start';

      const drawCol = (col: number) => {
        const label = this.getColumnFooter(col);
        if (!label) return;
        const x = this.columnScreenX(col);
        const colW = this.columnAxis.size(col);
        if (x + colW < gutter || x > width) return;
        const split = label.lastIndexOf(' ');
        const title = split > 0 ? label.slice(0, split) : label;
        const value = split > 0 ? label.slice(split + 1) : '';
        context.save();
        context.beginPath();
        context.rect(Math.max(x, gutter), y, colW, footerH);
        context.clip();
        context.font = `12px ${FONT_STACK}`;
        context.textBaseline = 'middle';
        const titleY = y + footerH * 0.32;
        context.fillText(title, x + 10, titleY);
        // 企微：记录数旁小三角
        if (title === '记录数') {
          const tw = context.measureText(title).width;
          context.beginPath();
          const cx = x + 10 + tw + 8;
          const cy = titleY + 1;
          context.moveTo(cx - 3, cy - 2);
          context.lineTo(cx + 3, cy - 2);
          context.lineTo(cx, cy + 3);
          context.closePath();
          context.fill();
        }
        if (value) {
          context.font = `13px ${FONT_STACK}`;
          context.fillText(value, x + 10, y + footerH * 0.7);
        }
        context.restore();
      };

      context.save();
      context.beginPath();
      context.rect(
        gutter + frozenW,
        y,
        Math.max(0, tableRight - gutter - frozenW),
        footerH,
      );
      context.clip();
      for (let col = bodyColumnStart; col < columns.end; col += 1) {
        drawCol(col);
      }
      context.restore();

      if (this.frozenColumnCount > 0) {
        for (let col = 0; col < this.frozenColumnCount; col += 1) {
          drawCol(col);
        }
      }

      context.restore();
    };

    paintOn(this.contexts.grid);
    paintOn(this.contexts.content);
    paintOn(this.contexts.selection);
  }

  private drawSelection(width: number, height: number): void {
    const context = this.contexts.selection;
    this.prepareContext(context, width, height, true);

    if (!this.selection) return;
    const { row, col } = this.selection;
    if (row >= this.rowAxis.count || col >= this.columns.length) return;

    const rect = this.cellRect(row, col);
    if (rect.y + rect.height < this.headerHeight) return;

    const tableRight = this.tableRight(width);
    context.save();
    context.beginPath();
    context.rect(
      this.rowGutterWidth,
      this.headerHeight,
      Math.max(0, tableRight - this.rowGutterWidth),
      Math.max(0, this.footerTop(height) - this.headerHeight),
    );
    context.clip();

    if (this.fillState) {
      const start = Math.min(this.fillState.fromRow, this.fillState.toRow);
      const end = Math.max(this.fillState.fromRow, this.fillState.toRow);
      const top = this.cellRect(start, col);
      const bottom = this.cellRect(end, col);
      context.fillStyle = 'rgba(45, 140, 240, 0.14)';
      context.fillRect(
        top.x,
        top.y,
        top.width,
        bottom.y + bottom.height - top.y,
      );
      context.strokeStyle = COLORS.selectionBorder;
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.strokeRect(
        top.x + 0.5,
        top.y + 0.5,
        Math.max(0, top.width - 1),
        Math.max(0, bottom.y + bottom.height - top.y - 1),
      );
      context.setLineDash([]);
    }

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

    if (this.options.onFillExtend) {
      const handle = this.fillHandleRect();
      if (handle) {
        context.fillStyle = COLORS.selectionBorder;
        context.fillRect(handle.x, handle.y, handle.size, handle.size);
        context.strokeStyle = '#fff';
        context.lineWidth = 1;
        context.strokeRect(
          handle.x + 0.5,
          handle.y + 0.5,
          handle.size - 1,
          handle.size - 1,
        );
      }
    }
    context.restore();
  }
}
