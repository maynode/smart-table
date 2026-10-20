import { PrismaClient } from '@prisma/client';
import { seedSerialClaim } from '../src/templates/serial-claim.seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await seedSerialClaim(prisma);
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
