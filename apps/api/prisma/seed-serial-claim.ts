import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedSerialClaim } from '../src/templates/serial-claim.seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await seedSerialClaim(prisma);
    // Playwright and smoke scripts read this instead of scraping the console.
    const summaryPath = resolve(
      __dirname,
      '../../../.data/serial-claim-seed.json',
    );
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
