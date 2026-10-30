import {
  formatExportDisplay,
  isPublishableGridContract,
  parseGridContract,
  readSortKey,
  type AiComponentGridContract,
} from './ai-component-contract';

const ratingContract: AiComponentGridContract = {
  sortKey: { path: 'rating', type: 'number' },
  filter: {
    path: 'rating',
    ops: ['eq', 'gte', 'lte'],
    valueType: 'number',
  },
  exportDisplay: { template: '{{rating}} 星' },
};

describe('ai-component-contract', () => {
  it('parses a complete gridContract', () => {
    const parsed = parseGridContract(ratingContract);
    expect(parsed).toEqual(ratingContract);
    expect(isPublishableGridContract(ratingContract)).toBe(true);
  });

  it('rejects incomplete contracts', () => {
    expect(isPublishableGridContract({})).toBe(false);
    expect(
      isPublishableGridContract({
        sortKey: { path: 'rating', type: 'number' },
      }),
    ).toBe(false);
    expect(
      isPublishableGridContract({
        ...ratingContract,
        exportDisplay: { template: '' },
      }),
    ).toBe(false);
  });

  it('reads sort key from cell object', () => {
    expect(readSortKey({ rating: 4 }, ratingContract)).toBe(4);
    expect(readSortKey({ rating: '3' }, ratingContract)).toBe(3);
    expect(readSortKey({}, ratingContract)).toBeNull();
  });

  it('formats export display from template', () => {
    expect(formatExportDisplay({ rating: 5 }, ratingContract)).toBe('5 星');
  });
});
