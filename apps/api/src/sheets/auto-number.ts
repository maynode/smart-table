import { Prisma } from '@prisma/client';
import type { AutoNumberOptions, FieldOptions } from 'shared';

/** Drop client-supplied autoNumber values so only the server assigns them. */
export async function stripAutoNumberInputs(
  tx: Prisma.TransactionClient,
  sheetId: string,
  cells: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await tx.field.findMany({
    where: { sheetId, type: 'autoNumber' },
    select: { id: true },
  });
  if (fields.length === 0) return cells;
  const next = { ...cells };
  for (const field of fields) {
    delete next[field.id];
  }
  return next;
}

/**
 * Assigns values for empty autoNumber cells inside an open transaction.
 * Uses a per-field advisory lock + options.autoNumber.next counter.
 */
export async function applyAutoNumbers(
  tx: Prisma.TransactionClient,
  sheetId: string,
  cells: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await tx.field.findMany({
    where: { sheetId, type: 'autoNumber' },
    select: { id: true, options: true },
  });
  if (fields.length === 0) return cells;

  const nextCells = { ...cells };

  for (const field of fields) {
    const existing = nextCells[field.id];
    if (existing !== undefined && existing !== null && existing !== '') {
      continue;
    }

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${sheetId}:${field.id}`}))`,
    );

    const fresh = await tx.field.findUnique({
      where: { id: field.id },
      select: { options: true },
    });
    const options = (fresh?.options ?? {}) as FieldOptions;
    const auto = (options.autoNumber ?? {}) as AutoNumberOptions;
    const start = Number.isFinite(auto.start) ? Number(auto.start) : 1;
    const padding = Math.max(0, Number(auto.padding) || 0);
    const prefix = typeof auto.prefix === 'string' ? auto.prefix : '';
    const next = Number.isFinite(auto.next as number)
      ? Number(auto.next)
      : start;
    const value = `${prefix}${String(next).padStart(padding, '0')}`;
    nextCells[field.id] = value;

    await tx.field.update({
      where: { id: field.id },
      data: {
        options: {
          ...options,
          autoNumber: {
            ...auto,
            start,
            padding,
            prefix,
            next: next + 1,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return nextCells;
}
