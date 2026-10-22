import { Prisma } from '@prisma/client';

/**
 * 企微网页版「新建工作表」默认列（对照截图）：
 * 文本 / 单选 / 人员 / 数字 / 日期 + 5 行空记录。
 */
export const BLANK_SHEET_FIELDS: Array<{
  name: string;
  type: string;
  order: number;
  options?: Record<string, unknown>;
}> = [
  { name: '文本', type: 'text', order: 0, options: { width: 180 } },
  {
    name: '单选',
    type: 'select',
    order: 1,
    options: {
      width: 120,
      choices: [],
    },
  },
  { name: '人员', type: 'person', order: 2, options: { width: 140 } },
  { name: '数字', type: 'number', order: 3, options: { width: 120 } },
  {
    name: '日期',
    type: 'date',
    order: 4,
    options: { width: 140, dateFormat: 'YYYY-MM-DD' },
  },
];

/** 企微空白表默认空行数 */
export const BLANK_SHEET_ROW_COUNT = 5;

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

  await tx.recordRow.createMany({
    data: Array.from({ length: BLANK_SHEET_ROW_COUNT }, () => ({
      sheetId,
      cells: {} as Prisma.InputJsonValue,
      ...(userId ? { createdBy: userId } : {}),
    })),
  });
}
