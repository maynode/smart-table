import { Prisma } from '@prisma/client';

/** Default columns for a newly created worksheet (企微空白表观感：多列可直接填). */
export const BLANK_SHEET_FIELDS: Array<{
  name: string;
  type: string;
  order: number;
  options?: Record<string, unknown>;
}> = [
  { name: '标题', type: 'text', order: 0, options: { width: 200 } },
  {
    name: '状态',
    type: 'select',
    order: 1,
    options: {
      width: 120,
      choices: [
        { id: 'todo', name: '未开始', color: 'gray' },
        { id: 'doing', name: '进行中', color: 'blue' },
        { id: 'done', name: '已完成', color: 'green' },
      ],
    },
  },
  { name: '负责人', type: 'person', order: 2, options: { width: 140 } },
  {
    name: '截止日期',
    type: 'date',
    order: 3,
    options: { width: 140, dateFormat: 'YYYY-MM-DD' },
  },
  {
    name: '优先级',
    type: 'select',
    order: 4,
    options: {
      width: 100,
      choices: [
        { id: 'high', name: '高', color: 'red' },
        { id: 'medium', name: '中', color: 'yellow' },
        { id: 'low', name: '低', color: 'gray' },
      ],
    },
  },
  { name: '备注', type: 'text', order: 5, options: { width: 220 } },
];

export async function seedBlankSheetStructure(
  tx: Prisma.TransactionClient,
  sheetId: string,
  userId?: string,
): Promise<void> {
  await tx.field.createMany({
    data: BLANK_SHEET_FIELDS.map((field) => ({
      sheetId,
      name: field.name,
      type: field.type,
      order: field.order,
      options: (field.options ?? {}) as Prisma.InputJsonValue,
    })),
  });

  // A few empty rows so the grid reads as a real table, not a blank canvas.
  await tx.recordRow.createMany({
    data: [0, 1, 2].map(() => ({
      sheetId,
      cells: {} as Prisma.InputJsonValue,
      ...(userId ? { createdBy: userId } : {}),
    })),
  });
}
