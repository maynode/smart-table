import { HyperFormula } from 'hyperformula';

export interface FormulaFieldConfig {
  id: string;
  name: string;
  type: string;
  options?: { formula?: string } | null;
}

export interface FormulaRecord {
  cells: Record<string, unknown>;
}

/** Common functions covered by the formula editor and the test suite. */
export const FORMULA_FUNCTIONS = [
  'SUM',
  'AVERAGE',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'IF',
  'IFERROR',
  'ROUND',
  'ROUNDUP',
  'ROUNDDOWN',
  'CONCATENATE',
  'TEXT',
  'AND',
  'OR',
  'NOT',
  'ABS',
  'CEILING',
  'FLOOR',
  'POWER',
  'SQRT',
  'VLOOKUP',
  'INDEX',
  'MATCH',
] as const;

function columnLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

/**
 * Formula syntax accepts both bracketed references (`=[数量]*[单价]`) and plain
 * field names (`=数量*单价`). References resolve to A1 addresses for the row.
 */
export function compileFormula(
  formula: string,
  fields: FormulaFieldConfig[],
  recordIndex: number,
): string {
  const rowNumber = recordIndex + 2; // row 1 is the header
  const byName = new Map(fields.map((field, index) => [field.name, index]));

  const resolve = (name: string): string | null => {
    const index = byName.get(name.trim());
    if (index === undefined) return null;
    return `${columnLabel(index)}${rowNumber}`;
  };

  let compiled = String(formula ?? '').trim();
  compiled = compiled.replace(/\[([^\]]+)\]/g, (match, name: string) => {
    return resolve(name) ?? match;
  });
  for (const field of fields) {
    if (!field.name) continue;
    if (compiled.includes(field.name)) {
      compiled = compiled.split(field.name).join(`${columnLabel(byName.get(field.name) ?? 0)}${rowNumber}`);
    }
  }
  return compiled.startsWith('=') ? compiled : `=${compiled}`;
}

/** Evaluate formula fields for a single record (dirty-row hot path). */
export function evaluateFormulaRecord(
  fields: FormulaFieldConfig[],
  record: FormulaRecord,
): Record<string, unknown> {
  return evaluateFormulaRows(fields, [record])[0] ?? {};
}

/** Evaluate every formula field for all records, returning raw values by row. */
export function evaluateFormulaRows(
  fields: FormulaFieldConfig[],
  records: FormulaRecord[],
): Array<Record<string, unknown>> {
  if (fields.length === 0 || records.length === 0) return [];

  const matrix: Array<Array<string | number | boolean | null>> = [
    fields.map((field) => field.name),
  ];
  records.forEach((record, recordIndex) => {
    matrix.push(
      fields.map((field) => {
        if (field.type === 'formula') {
          const formula = field.options?.formula?.trim();
          if (!formula) return null;
          return compileFormula(formula, fields, recordIndex);
        }
        const value = record.cells[field.id];
        if (value === undefined || value === null || value === '') return null;
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }),
    );
  });

  const engine = HyperFormula.buildFromArray(matrix, {
    licenseKey: 'gpl-v3',
  });
  try {
    const sheetId = engine.getSheetId('Sheet1') ?? 0;
    return records.map((_, recordIndex) => {
      const values: Record<string, unknown> = {};
      fields.forEach((field, columnIndex) => {
        if (field.type !== 'formula') return;
        const value = engine.getCellValue({
          sheet: sheetId,
          row: recordIndex + 1,
          col: columnIndex,
        });
        values[field.id] =
          value === null || value === undefined ? '' : value;
      });
      return values;
    });
  } finally {
    engine.destroy();
  }
}
