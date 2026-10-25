import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const bases = await p.base.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  include: { sheets: true, forms: true },
});
for (const b of bases) {
  console.log(
    'BASE',
    b.name,
    'forms',
    b.forms.length,
    'sheets',
    b.sheets.map((s) => s.name).join(','),
  );
  for (const f of b.forms) {
    console.log(' FORM', f.name, 'fields', JSON.stringify(f.fields));
    const sf = await p.field.findMany({
      where: { sheetId: f.sheetId },
      select: { id: true, name: true },
    });
    console.log(' SF', sf);
  }
}
await p.$disconnect();
