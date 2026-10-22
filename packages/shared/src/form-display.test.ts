import {
  dependentsByTrigger,
  evaluateDisplayConditions,
  formatInboundDependentsLabel,
  formatOutboundConditionLabel,
  isFormFieldVisible,
  relatedDisplayFieldIds,
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

describe('display condition visibility labels', () => {
  const names = (id: string) =>
    ({ purpose: '来访目的', note: '备注', attach: '附件', extra: '地址', phone: '手机号' })[
      id
    ] ?? id;

  it('builds reverse index and related highlight set', () => {
    const fields = [
      { fieldId: 'purpose' },
      {
        fieldId: 'note',
        displayConditions: [
          { fieldId: 'purpose', operator: 'equals' as const, value: '到访' },
        ],
      },
      {
        fieldId: 'attach',
        displayConditions: [
          { fieldId: 'purpose', operator: 'equals' as const, value: '到访' },
        ],
      },
    ];

    expect(dependentsByTrigger(fields).get('purpose')).toEqual(['note', 'attach']);
    expect([...relatedDisplayFieldIds('purpose', fields)].sort()).toEqual([
      'attach',
      'note',
    ]);
    expect([...relatedDisplayFieldIds('note', fields)]).toEqual(['purpose']);
  });

  it('formats outbound and inbound tags', () => {
    expect(
      formatOutboundConditionLabel(
        { fieldId: 'purpose', operator: 'equals', value: '到访' },
        names,
      ),
    ).toBe('依赖 · 来访目的 等于 到访');
    expect(
      formatOutboundConditionLabel({ fieldId: 'phone', operator: 'notEmpty' }, names),
    ).toBe('依赖 · 手机号 不为空');
    expect(formatInboundDependentsLabel(['备注', '附件'])).toBe('被依赖 · 备注、附件');
    expect(
      formatInboundDependentsLabel(['备注', '附件', '地址', '电话']),
    ).toBe('被依赖 · 备注、附件 等 4 个');
    expect(formatInboundDependentsLabel([])).toBeNull();
  });
});
