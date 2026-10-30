import { applyAiFields, stripAiFieldInputs } from './ai-field';

type FieldRow = {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown> | null;
};

function mockTx(fields: FieldRow[]) {
  return {
    field: {
      findMany: jest.fn(async ({ where }: { where: { sheetId: string; type?: string } }) => {
        if (where.type) {
          return fields.filter((field) => field.type === where.type);
        }
        return fields;
      }),
    },
  };
}

describe('ai-field', () => {
  const fields: FieldRow[] = [
    { id: 'f-title', name: '标题', type: 'text', options: null },
    {
      id: 'f-ai',
      name: '摘要',
      type: 'ai',
      options: {
        ai: {
          prompt: '摘要：{{标题}}',
          sourceFieldIds: ['f-title'],
          provider: 'local',
        },
      },
    },
  ];

  it('strips client-supplied AI values', async () => {
    const tx = mockTx(fields);
    const next = await stripAiFieldInputs(tx as never, 'sheet-1', {
      'f-title': '你好',
      'f-ai': 'hacked',
    });
    expect(next).toEqual({ 'f-title': '你好' });
  });

  it('fills empty AI cells from local prompt template', async () => {
    const tx = mockTx(fields);
    const next = await applyAiFields(tx as never, 'sheet-1', {
      'f-title': '季度复盘',
    });
    expect(next['f-ai']).toBe('摘要：季度复盘');
  });

  it('refills when source fields change', async () => {
    const tx = mockTx(fields);
    const next = await applyAiFields(
      tx as never,
      'sheet-1',
      { 'f-title': '新标题', 'f-ai': '旧摘要' },
      { 'f-title': '旧标题', 'f-ai': '旧摘要' },
    );
    expect(next['f-ai']).toBe('摘要：新标题');
  });

  it('keeps value when sources unchanged', async () => {
    const tx = mockTx(fields);
    const next = await applyAiFields(
      tx as never,
      'sheet-1',
      { 'f-title': '同标题', 'f-ai': '旧摘要' },
      { 'f-title': '同标题', 'f-ai': '旧摘要' },
    );
    expect(next['f-ai']).toBe('旧摘要');
  });

  it('refills when object source (aiComponent) changes', async () => {
    const objectFields: FieldRow[] = [
      { id: 'f-rate', name: '满意度', type: 'aiComponent', options: null },
      {
        id: 'f-ai',
        name: '摘要',
        type: 'ai',
        options: {
          ai: {
            prompt: '评分{{满意度}}',
            sourceFieldIds: ['f-rate'],
            provider: 'local',
          },
        },
      },
    ];
    const tx = mockTx(objectFields);
    const next = await applyAiFields(
      tx as never,
      'sheet-1',
      { 'f-rate': { rating: 5 }, 'f-ai': '旧摘要' },
      { 'f-rate': { rating: 4 }, 'f-ai': '旧摘要' },
    );
    expect(next['f-ai']).toBe('评分5 星');
  });
});
