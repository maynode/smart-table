import {
  evaluateDisplayConditions,
  isFormFieldVisible,
} from './form-display';

describe('display conditions', () => {
  const phone = 'phone-field';

  it('shows fields without conditions', () => {
    expect(isFormFieldVisible({ fieldId: 'a' }, {})).toBe(true);
  });

  it('evaluates equals/notEmpty/contains against submitted values', () => {
    const conditions = [
      { fieldId: phone, operator: 'equals' as const, value: '13800000000' },
    ];

    expect(isFormFieldVisible({ fieldId: 'b', displayConditions: conditions }, {})).toBe(false);
    expect(
      isFormFieldVisible({ fieldId: 'b', displayConditions: conditions }, {
        [phone]: '13800000000',
      }),
    ).toBe(true);

    expect(
      evaluateDisplayConditions(
        [{ fieldId: phone, operator: 'notEmpty' }],
        { [phone]: '1' },
      ),
    ).toBe(true);
    expect(
      evaluateDisplayConditions(
        [{ fieldId: phone, operator: 'contains', value: '800' }],
        { [phone]: '13800000000' },
      ),
    ).toBe(true);
  });

  it('requires every condition to pass (AND)', () => {
    const conditions = [
      { fieldId: phone, operator: 'notEmpty' as const },
      { fieldId: 'city', operator: 'equals' as const, value: '上海' },
    ];

    expect(
      evaluateDisplayConditions(conditions, { [phone]: '1', city: '上海' }),
    ).toBe(true);
    expect(
      evaluateDisplayConditions(conditions, { [phone]: '1', city: '北京' }),
    ).toBe(false);
  });
});
