/**
 * Success-page rendering: `formCells ∪ stepOutputs`, where automation outputs
 * override same-named form cells (spec §5.2 / Task 8).
 */
export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Interpolated values are escaped; the template HTML itself is trusted admin content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SuccessValuesInput {
  formCells?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
}

export function buildSuccessValues(
  input: SuccessValuesInput,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.formCells ?? {})) {
    values[key] = stringifyValue(value);
  }
  // Automation outputs win over form cells with the same name.
  for (const [key, value] of Object.entries(input.stepOutputs ?? {})) {
    values[key] = stringifyValue(value);
  }

  return values;
}

const TEMPLATE_VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function renderSuccessTemplate(
  templateHtml: string,
  values: Record<string, string>,
): string {
  return templateHtml.replace(TEMPLATE_VAR, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      // Unknown variables stay visible instead of throwing or blanking the page.
      return match;
    }
    return escapeHtml(values[key]);
  });
}
