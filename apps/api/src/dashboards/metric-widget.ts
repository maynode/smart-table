/** Pure helpers for NUMBER / metric dashboard widgets. */

export type CompareMode = 'none' | 'mom' | 'yoy';

export type ConditionalOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';

export interface ConditionalRule {
  op: ConditionalOp;
  value: number;
  value2?: number;
  color: string;
}

export interface CompareWindows {
  currentFrom: Date;
  currentTo: Date;
  previousFrom: Date;
  previousTo: Date;
  label: string;
}

/** Resolve 环比 (mom) / 同比 (yoy) windows ending at `now`. */
export function resolveCompareWindows(
  mode: CompareMode,
  windowDays = 30,
  now = new Date(),
): CompareWindows | null {
  if (mode === 'none') return null;
  const days = Math.min(Math.max(windowDays, 1), 366);
  const ms = days * 24 * 60 * 60 * 1000;
  const currentTo = now;
  const currentFrom = new Date(now.getTime() - ms);
  if (mode === 'mom') {
    return {
      currentFrom,
      currentTo,
      previousFrom: new Date(currentFrom.getTime() - ms),
      previousTo: currentFrom,
      label: `环比近${days}天`,
    };
  }
  // yoy: same window length, shifted ~365 days
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  return {
    currentFrom,
    currentTo,
    previousFrom: new Date(currentFrom.getTime() - yearMs),
    previousTo: new Date(currentTo.getTime() - yearMs),
    label: '同比去年同期',
  };
}

export function matchConditionalColor(
  value: number,
  rules: ConditionalRule[] | undefined,
): string | undefined {
  if (!rules?.length) return undefined;
  for (const rule of rules) {
    const v = rule.value;
    const v2 = rule.value2 ?? v;
    let hit = false;
    switch (rule.op) {
      case 'gt':
        hit = value > v;
        break;
      case 'gte':
        hit = value >= v;
        break;
      case 'lt':
        hit = value < v;
        break;
      case 'lte':
        hit = value <= v;
        break;
      case 'eq':
        hit = value === v;
        break;
      case 'between':
        hit = value >= Math.min(v, v2) && value <= Math.max(v, v2);
        break;
      default:
        hit = false;
    }
    if (hit && rule.color) return rule.color;
  }
  return undefined;
}

export function formatMetricDelta(
  current: number,
  previous: number | null,
): { delta: number | null; deltaPercent: number | null } {
  if (previous === null || !Number.isFinite(previous)) {
    return { delta: null, deltaPercent: null };
  }
  const delta = current - previous;
  if (previous === 0) {
    return { delta, deltaPercent: current === 0 ? 0 : null };
  }
  return {
    delta,
    deltaPercent: Math.round((delta / Math.abs(previous)) * 1000) / 10,
  };
}
