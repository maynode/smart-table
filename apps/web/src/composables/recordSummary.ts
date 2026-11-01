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

export function formatCellSummary(
  value: unknown,
  fieldType: string,
): string {
  if (value == null || value === '') return '—';
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
    return '人员';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}
