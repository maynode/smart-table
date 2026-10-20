import { evaluateFilterCondition, evaluateFilterGroup } from './filter-eval';

describe('filter evaluation', () => {
  const values = {
    status: '未领',
    phone: '',
    serial: 'TEST-01',
    count: 5,
  };

  it('handles equality and emptiness', () => {
    expect(
      evaluateFilterCondition(
        { fieldId: 'status', operator: 'equals', value: '未领' },
        values,
      ),
    ).toBe(true);
    expect(
      evaluateFilterCondition(
        { fieldId: 'phone', operator: 'isEmpty' },
        values,
      ),
    ).toBe(true);
    expect(
      evaluateFilterCondition(
        { fieldId: 'phone', operator: 'isNotEmpty' },
        values,
      ),
    ).toBe(false);
  });

  it('compares numbers and combines groups', () => {
    expect(
      evaluateFilterCondition(
        { fieldId: 'count', operator: 'gt', value: 3 },
        values,
      ),
    ).toBe(true);

    expect(
      evaluateFilterGroup(
        {
          conjunction: 'and',
          conditions: [
            { fieldId: 'status', operator: 'equals', value: '未领' },
            {
              conjunction: 'or',
              conditions: [
                { fieldId: 'count', operator: 'lt', value: 1 },
                { fieldId: 'serial', operator: 'contains', value: 'TEST' },
              ],
            },
          ],
        },
        values,
      ),
    ).toBe(true);
  });

  it('supports in/between/isTrue', () => {
    expect(
      evaluateFilterCondition(
        { fieldId: 'status', operator: 'in', value: ['未领', '已领'] },
        values,
      ),
    ).toBe(true);
    expect(
      evaluateFilterCondition(
        { fieldId: 'count', operator: 'between', value: [1, 10] },
        values,
      ),
    ).toBe(true);
    expect(
      evaluateFilterCondition(
        { fieldId: 'done', operator: 'isTrue' },
        { done: true },
      ),
    ).toBe(true);
  });
});
