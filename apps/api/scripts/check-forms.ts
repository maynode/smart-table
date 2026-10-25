import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  try {
    const bases = await p.base.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { sheets: true, forms: true },
    });
    for (const b of bases) {
      console.log(
        'BASE',
        b.name,
        b.id.slice(0, 8),
        'forms',
        b.forms.length,
        'sheets',
        b.sheets.map((s) => s.name).join(','),
      );
      for (const f of b.forms) {
        console.log(
          '  FORM',
          f.name,
          'fields=',
          JSON.stringify(f.fields),
        );
        const sheetFields = await p.field.findMany({
          where: { sheetId: f.sheetId },
          select: { id: true, name: true, type: true },
        });
        console.log('  SHEET_FIELDS', sheetFields);
      }
      for (const s of b.sheets.filter((x) => x.name === '收集表单')) {
        const n = await p.field.count({ where: { sheetId: s.id } });
        const hasForm = b.forms.some((f) => f.sheetId === s.id);
        console.log('  收集表单 sheet', s.id.slice(0, 8), 'fieldCount', n, 'hasForm', hasForm);
      }
    }
  } finally {
    await p.$disconnect();
  }
}

void main();
