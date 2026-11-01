import {
  formatExportDisplay,
  parseGridContract,
  type AiComponentOptions,
} from 'shared';

export type SummaryFieldLike = {
  id: string;
  name: string;
  type: string;
  options?: unknown;
};

const SYSTEMISH = new Set([
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
]);

/**
 * Pick title-like primary + up to `max` summary fields for phone list cards.
 * Prefer type `title`, else first non-system field as title; then next visible columns.
 */
export function pickSummaryFields(
  fields: SummaryFieldLike[],
  viewFieldIds: string[] | null | undefined,
  max = 3,
): { titleFieldId: string | null; summaryFieldIds: string[] } {
  const ordered =
    viewFieldIds && viewFieldIds.length
      ? viewFieldIds
          .map((id) => fields.find((f) => f.id === id))
          .filter((f): f is SummaryFieldLike => Boolean(f))
      : [...fields];

  const usable = ordered.filter((f) => !SYSTEMISH.has(f.type));
  const title =
    usable.find((f) => f.type === 'title') ?? usable[0] ?? null;
  const titleFieldId = title?.id ?? null;
  const summaryFieldIds = usable
    .filter((f) => f.id !== titleFieldId)
    .slice(0, Math.max(0, max))
    .map((f) => f.id);
  return { titleFieldId, summaryFieldIds };
}

const AI_STATUS_LABELS: Record<string, string> = {
  approved: '通过',
  rejected: '驳回',
  pending: '待定',
};

function localizeAiStatus(status: string): string {
  return AI_STATUS_LABELS[status] ?? status;
}

/** Localize enum tokens + drop trailing empty separators from export templates. */
export function polishAiExportDisplay(display: string): string {
  if (!display) return display;
  let s = display
    .replace(/\bapproved\b/gi, '通过')
    .replace(/\brejected\b/gi, '驳回')
    .replace(/\bpending\b/gi, '待定');
  s = s.replace(/\s*[：:]\s*$/, '').trim();
  return s;
}

function choiceLabel(
  value: unknown,
  options: unknown,
): string | null {
  const choices = (
    options as { choices?: Array<{ id: string; name: string }> } | null
  )?.choices;
  if (!choices?.length) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    const hit = choices.find(
      (c) => c.id === String(value) || c.name === String(value),
    );
    return hit?.name ?? null;
  }
  if (Array.isArray(value)) {
    const labels = value
      .map((v) => {
        const hit = choices.find(
          (c) => c.id === String(v) || c.name === String(v),
        );
        return hit?.name ?? String(v);
      })
      .filter(Boolean);
    return labels.length ? labels.join('、') : null;
  }
  return null;
}

export function formatCellSummary(
  value: unknown,
  fieldType: string,
  options?: unknown,
): string {
  if (value == null || value === '') return '—';
  if (
    fieldType === 'select' ||
    fieldType === 'singleSelect' ||
    fieldType === 'multiSelect'
  ) {
    const labeled = choiceLabel(value, options);
    if (labeled) return labeled;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return value.map(String).join('、');
    }
    return `${value.length} 项`;
  }
  if (fieldType === 'person' || fieldType === 'createdBy') {
    if (typeof value === 'object' && value && 'account' in value) {
      return String((value as { account?: string }).account ?? '人员');
    }
    return '人员';
  }
  if (fieldType === 'aiComponent') {
    const ac = (options as { aiComponent?: AiComponentOptions } | null)
      ?.aiComponent;
    const contract = parseGridContract(ac?.gridContract);
    if (contract) {
      const display = polishAiExportDisplay(
        formatExportDisplay(value, contract).trim(),
      );
      // Skip unresolved templates like "已完成 /" or empty placeholders
      if (display && !/(^|\/)\s*$/.test(display) && !/\{\{/.test(display)) {
        return display;
      }
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.displayText === 'string' && obj.displayText.trim()) {
        return obj.displayText.trim();
      }
      if (typeof obj.display === 'string' && obj.display.trim()) {
        return obj.display.trim();
      }
      if (typeof obj.rating === 'number') return `${obj.rating} 星`;
      if (typeof obj.on === 'boolean') return obj.on ? '开' : '关';
      if (typeof obj.progress === 'number') return `${obj.progress}%`;
      if (typeof obj.status === 'string') {
        const label = localizeAiStatus(obj.status);
        const note =
          typeof obj.note === 'string' && obj.note.trim()
            ? `：${obj.note.trim()}`
            : '';
        return `${label}${note}`;
      }
      if (Array.isArray(obj.items)) {
        const items = obj.items as Array<{ done?: boolean }>;
        const done = items.filter((i) => i?.done).length;
        return `已完成 ${done}/${items.length}`;
      }
      if (typeof obj.remainingHours === 'number') {
        return obj.remainingHours < 0
          ? `已超时 ${Math.abs(obj.remainingHours)}h`
          : `剩余 ${obj.remainingHours}h`;
      }
      if (typeof obj.deadline === 'string') {
        const t = Date.parse(obj.deadline);
        if (Number.isFinite(t)) {
          const rem = (t - Date.now()) / 3600000;
          return rem < 0
            ? `已超时 ${Math.abs(Math.round(rem * 10) / 10)}h`
            : `剩余 ${Math.round(rem * 10) / 10}h`;
        }
      }
    }
    return '组件';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

/** Prefer title field, then first non-empty summary / usable cell. */
export function resolveRecordPrimaryText(
  cells: Record<string, unknown> | null | undefined,
  fields: SummaryFieldLike[],
  layout: { titleFieldId: string | null; summaryFieldIds: string[] },
  fallback = '未命名记录',
): string {
  const map = new Map(fields.map((f) => [f.id, f]));
  const tryIds = [
    layout.titleFieldId,
    ...layout.summaryFieldIds,
    ...fields.map((f) => f.id),
  ].filter((id): id is string => Boolean(id));
  const seen = new Set<string>();
  for (const id of tryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const field = map.get(id);
    if (!field || SYSTEMISH.has(field.type)) continue;
    const text = formatCellSummary(cells?.[id], field.type, field.options);
    if (text && text !== '—') return text;
  }
  return fallback;
}
