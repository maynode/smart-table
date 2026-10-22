import type { Prisma } from '@prisma/client';

type Tx = {
  recordRow: {
    findUnique: (args: {
      where: { id: string };
    }) => Promise<{ id: string; cells: unknown } | null>;
    update: (args: {
      where: { id: string };
      data: {
        cells: Prisma.InputJsonValue;
        version: { increment: number };
      };
    }) => Promise<unknown>;
  };
};

function asIdList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((item): item is string => typeof item === 'string' && !!item);
}

function withLink(value: unknown, recordId: string, multiple: boolean): string | string[] {
  const existing = asIdList(value);
  if (existing.includes(recordId)) {
    return multiple ? existing : recordId;
  }
  if (multiple) return [...existing, recordId];
  return recordId;
}

function withoutLink(value: unknown, recordId: string, multiple: boolean): string | string[] | null {
  const existing = asIdList(value).filter((id) => id !== recordId);
  if (multiple) return existing;
  return existing[0] ?? null;
}

export interface RelationFieldMeta {
  id: string;
  options: unknown;
}

/**
 * Mirror WeCom TWO_WAY_LINK: when a bidirectional relation cell changes,
 * patch the paired reverse field on the target record(s). Does not recurse.
 */
export async function syncBidirectionalRelations(
  tx: Tx,
  fields: RelationFieldMeta[],
  sourceRecordId: string,
  previousCells: Record<string, unknown>,
  nextCells: Record<string, unknown>,
  changedFieldIds: string[],
): Promise<void> {
  for (const field of fields) {
    if (!changedFieldIds.includes(field.id)) continue;
    const relation = (
      field.options as {
        relation?: {
          bidirectional?: boolean;
          reverseFieldId?: string;
          multiple?: boolean;
        };
      } | null
    )?.relation;
    if (!relation?.bidirectional || !relation.reverseFieldId) continue;

    const before = asIdList(previousCells[field.id]);
    const after = asIdList(nextCells[field.id]);
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    const multiple = Boolean(relation.multiple);
    const reverseFieldId = relation.reverseFieldId;

    for (const targetId of added) {
      const target = await tx.recordRow.findUnique({ where: { id: targetId } });
      if (!target) continue;
      const cells = { ...((target.cells ?? {}) as Record<string, unknown>) };
      cells[reverseFieldId] = withLink(cells[reverseFieldId], sourceRecordId, multiple);
      await tx.recordRow.update({
        where: { id: targetId },
        data: {
          cells: cells as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    }

    for (const targetId of removed) {
      const target = await tx.recordRow.findUnique({ where: { id: targetId } });
      if (!target) continue;
      const cells = { ...((target.cells ?? {}) as Record<string, unknown>) };
      const next = withoutLink(cells[reverseFieldId], sourceRecordId, multiple);
      if (next === null || (Array.isArray(next) && next.length === 0)) {
        delete cells[reverseFieldId];
      } else {
        cells[reverseFieldId] = next;
      }
      await tx.recordRow.update({
        where: { id: targetId },
        data: {
          cells: cells as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    }
  }
}
