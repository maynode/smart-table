import {
  compileFormula,
  evaluateFormulaRows,
  type FormulaFieldConfig,
} from '../src/formula';

const fields: FormulaFieldConfig[] = [
  { id: 'qty', name: '数量', type: 'number' },
  { id: 'price', name: '单价', type: 'number' },
  { id: 'total', name: '合计', type: 'formula', options: { formula: '=数量*单价' } },
  {
    id: 'withTax',
    name: '含税',
    type: 'formula',
    options: { formula: '=ROUND([合计]*1.13, 2)' },
  },
  { id: 'constant', name: '常量', type: 'formula', options: { formula: '=1+1' } },
];

describe('HyperFormula integration', () => {
  it('compiles field names and bracket references to A1 addresses', () => {
    expect(compileFormula('=数量*单价', fields, 0)).toBe('=A2*B2');
    expect(compileFormula('=[数量]*[单价]', fields, 2)).toBe('=A4*B4');
  });

  it('evaluates constants, cross-field references, and nested formulas', () => {
    const values = evaluateFormulaRows(fields, [
      { cells: { qty: 2, price: 10 } },
      { cells: { qty: 3, price: 7 } },
    ]);

    expect(values[0]['total']).toBe(20);
    expect(values[0]['withTax']).toBe(22.6);
    expect(values[0]['constant']).toBe(2);
    expect(values[1]['total']).toBe(21);
    expect(values[1]['withTax']).toBe(23.73);
  });
});
