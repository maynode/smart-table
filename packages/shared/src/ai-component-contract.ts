/** AI 智能组件：发布时必带的网格合同（筛选/排序/导出）。 */

export type AiComponentFilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'empty'
  | 'notEmpty';

export type AiComponentGridContract = {
  /** JSON path relative to cell value, e.g. `rating` or `` (root) */
  sortKey: {
    path: string;
    type: 'number' | 'string' | 'boolean';
  };
  filter: {
    ops: AiComponentFilterOp[];
    /** Path used for comparison; often same as sortKey.path */
    path: string;
    valueType: 'number' | 'string' | 'boolean';
  };
  /** How to render cell for export/print. `{{path}}` placeholders. */
  exportDisplay: {
    template: string;
  };
};

export type AiComponentBridgeManifest = {
  cell?: boolean;
  rowFields?: string[] | '*';
  automations?: string[] | '*';
  network?: boolean;
};

export type AiComponentBundle = {
  html: string;
  css?: string;
  js?: string;
};

export type AiComponentAttachment = {
  url: string;
  name: string;
  mimetype: string;
  size: number;
};

export type AiComponentChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: AiComponentAttachment[];
};

export type AiComponentOptions = {
  status?: 'draft' | 'published' | 'failed';
  version?: number;
  sessionId?: string;
  messages?: AiComponentChatMessage[];
  bundle?: AiComponentBundle;
  bundleUrl?: string;
  contentHash?: string;
  bridgeManifest?: AiComponentBridgeManifest;
  valueSchema?: Record<string, unknown>;
  gridContract?: AiComponentGridContract;
};

export function parseGridContract(raw: unknown): AiComponentGridContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const sortKey = obj.sortKey;
  const filter = obj.filter;
  const exportDisplay = obj.exportDisplay;
  if (!sortKey || typeof sortKey !== 'object') return null;
  if (!filter || typeof filter !== 'object') return null;
  if (!exportDisplay || typeof exportDisplay !== 'object') return null;
  const sk = sortKey as Record<string, unknown>;
  const fl = filter as Record<string, unknown>;
  const ex = exportDisplay as Record<string, unknown>;
  if (typeof sk.path !== 'string') return null;
  if (sk.type !== 'number' && sk.type !== 'string' && sk.type !== 'boolean') {
    return null;
  }
  if (typeof fl.path !== 'string') return null;
  if (!Array.isArray(fl.ops) || fl.ops.length === 0) return null;
  if (
    fl.valueType !== 'number' &&
    fl.valueType !== 'string' &&
    fl.valueType !== 'boolean'
  ) {
    return null;
  }
  if (typeof ex.template !== 'string' || !ex.template.trim()) return null;
  return {
    sortKey: { path: sk.path, type: sk.type },
    filter: {
      path: fl.path,
      ops: fl.ops as AiComponentFilterOp[],
      valueType: fl.valueType,
    },
    exportDisplay: { template: ex.template },
  };
}

export function isPublishableGridContract(
  raw: unknown,
): raw is AiComponentGridContract {
  return parseGridContract(raw) != null;
}

/** Read a dotted path from cell value; empty path returns the root. */
export function readPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function readSortKey(
  cell: unknown,
  contract: AiComponentGridContract,
): string | number | boolean | null {
  const raw = readPath(cell, contract.sortKey.path);
  if (raw === null || raw === undefined || raw === '') return null;
  if (contract.sortKey.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (contract.sortKey.type === 'boolean') {
    return Boolean(raw);
  }
  return String(raw);
}

export function formatExportDisplay(
  cell: unknown,
  contract: AiComponentGridContract,
): string {
  return contract.exportDisplay.template.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_, rawPath: string) => {
      const path = rawPath.trim();
      const v = path === '.' || path === '' ? cell : readPath(cell, path);
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return String(v);
      }
      try {
        return JSON.stringify(v);
      } catch {
        return '';
      }
    },
  );
}
