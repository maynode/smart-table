import {
  DEFAULT_FIND_LIMIT,
  resolveFindLimit,
  resolveOnEmpty,
  type FindRecordsStep,
} from './automation-types';
import { FIELD_TYPE_LABELS, FIELD_TYPES } from './field-types';

describe('automation contracts', () => {
  it('defaultFindLimitIsOne', () => {
    expect(DEFAULT_FIND_LIMIT).toBe(1);

    const step: FindRecordsStep = {
      id: 'step-2',
      type: 'findRecords',
      sheetId: 'sheet-codes',
    };

    // No explicit limit -> exactly 1 record (WeCom gap we deliberately close).
    expect(resolveFindLimit(step)).toBe(1);
    expect(resolveFindLimit({ ...step, limit: 5 })).toBe(5);
    expect(resolveFindLimit({ ...step, limit: 0 })).toBe(1);
  });

  it('find-empty policy resolves at step level first, then automation level', () => {
    const step: FindRecordsStep = {
      id: 'step-2',
      type: 'findRecords',
      sheetId: 'sheet-codes',
    };

    expect(resolveOnEmpty(step)).toBe('continue');
    expect(resolveOnEmpty({ ...step, onEmpty: 'stop' })).toBe('stop');
    expect(resolveOnEmpty(step, { onFindEmpty: 'stop' })).toBe('stop');
    expect(
      resolveOnEmpty({ ...step, onEmpty: 'continue' }, { onFindEmpty: 'stop' }),
    ).toBe('continue');
  });
});

describe('field type contract', () => {
  it('fieldTypeEnumCoversWecomScreenshotList', () => {
    // Merged from wecom smart-table/01-field-types/01 + 02.
    const expectedLabels = [
      '文本',
      '多行文本',
      '单选',
      '多选',
      '数字',
      '百分数',
      '货币',
      '进度',
      '日期',
      '人员',
      '群聊',
      '图片',
      '文件',
      '关联',
      '链接',
      '电话',
      '邮箱',
      '地理位置',
      '复选框',
      '条码',
      '自动编号',
      '公式',
      '查找引用',
      '创建人',
      '最后编辑人',
      '创建时间',
      '最后编辑时间',
      'AI 字段',
    ];

    const labels = Object.values(FIELD_TYPE_LABELS);
    for (const label of expectedLabels) {
      expect(labels).toContain(label);
    }
    expect(new Set(FIELD_TYPES).size).toBe(FIELD_TYPES.length);
  });
});
