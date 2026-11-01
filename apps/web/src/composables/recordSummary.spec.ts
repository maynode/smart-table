import { describe, expect, it } from 'vitest';
import {
  formatCellSummary,
  pickSummaryFields,
  resolveRecordPrimaryText,
} from './recordSummary';

describe('pickSummaryFields', () => {
  const fields = [
    { id: 'a', name: '创建时间', type: 'createdTime' },
    { id: 'b', name: '姓名', type: 'text' },
    { id: 'c', name: '状态', type: 'singleSelect' },
    { id: 'd', name: '标题', type: 'title' },
    { id: 'e', name: '备注', type: 'text' },
  ];

  it('prefers title type and next summaries', () => {
    const r = pickSummaryFields(fields, null, 2);
    expect(r.titleFieldId).toBe('d');
    expect(r.summaryFieldIds).toEqual(['b', 'c']);
  });

  it('respects view column order when no title', () => {
    const noTitle = fields.filter((f) => f.type !== 'title');
    const r = pickSummaryFields(noTitle, ['c', 'b', 'e'], 2);
    expect(r.titleFieldId).toBe('c');
    expect(r.summaryFieldIds).toEqual(['b', 'e']);
  });
});

describe('formatCellSummary', () => {
  it('formats primitives and arrays', () => {
    expect(formatCellSummary(null, 'text')).toBe('—');
    expect(formatCellSummary('hi', 'text')).toBe('hi');
    expect(formatCellSummary(['a', 'b'], 'multiSelect')).toBe('a、b');
  });

  it('resolves select choice ids to labels', () => {
    const opts = {
      choices: [
        { id: 'new', name: '新客' },
        { id: 'won', name: '成交' },
      ],
    };
    expect(formatCellSummary('won', 'select', opts)).toBe('成交');
  });

  it('formats aiComponent via gridContract or shortcuts', () => {
    expect(
      formatCellSummary(
        { rating: 4 },
        'aiComponent',
        {
          aiComponent: {
            status: 'published',
            gridContract: {
              sortKey: { path: 'rating', type: 'number' },
              filter: {
                path: 'rating',
                ops: ['eq'],
                valueType: 'number',
              },
              exportDisplay: { template: '{{rating}}星' },
            },
          },
        },
      ),
    ).toBe('4星');
    expect(formatCellSummary({ on: true }, 'aiComponent', {})).toBe('开');
  });
});

describe('resolveRecordPrimaryText', () => {
  it('falls back to first non-empty cell when title empty', () => {
    const fields = [
      { id: 't', name: '标题', type: 'title' },
      { id: 'n', name: '姓名', type: 'text' },
    ];
    const layout = pickSummaryFields(fields, null, 2);
    expect(
      resolveRecordPrimaryText({ t: '', n: '王敏' }, fields, layout),
    ).toBe('王敏');
  });
});
