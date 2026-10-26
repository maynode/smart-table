import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { SheetDigest } from './sheet-digest.types';

const SAMPLE_LIMIT = 200;
const TOP_VALUE_LIMIT = 5;

@Injectable()
export class SheetDigestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async buildDigests(
    sheetIds: string[],
    userId: string,
  ): Promise<SheetDigest[]> {
    const digests: SheetDigest[] = [];
    for (const sheetId of sheetIds) {
      let decision;
      try {
        decision = await this.permissions.assertCan(
          'sheet',
          sheetId,
          userId,
          'read',
        );
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ) {
          continue;
        }
        throw error;
      }

      const sheet = await this.prisma.sheet.findUnique({
        where: { id: sheetId },
        include: {
          fields: { orderBy: { order: 'asc' } },
        },
      });
      if (!sheet) continue;

      const visibleFields = this.permissions.filterVisibleFields(
        decision,
        sheet.fields,
      );

      const canSeeAllRows =
        decision.role === 'owner' ||
        decision.role === 'admin' ||
        !decision.recordRule ||
        decision.recordRule.mode === 'all';

      const rawRows = await this.prisma.recordRow.findMany({
        where: { sheetId },
        take: SAMPLE_LIMIT,
        orderBy: { id: 'asc' },
        select: { id: true, cells: true, createdBy: true },
      });
      const rows = this.permissions.applyReadScope(
        decision,
        rawRows,
        userId,
      );

      const recordCount = canSeeAllRows
        ? await this.prisma.recordRow.count({ where: { sheetId } })
        : rows.length;

      const fields = visibleFields.map((field) => {
        const counts = new Map<string, number>();
        let nonEmpty = 0;
        let empty = 0;
        for (const row of rows) {
          const cells = (row.cells ?? {}) as Record<string, unknown>;
          const raw = cells[field.id];
          const text = cellToText(raw);
          if (!text) {
            empty += 1;
            continue;
          }
          nonEmpty += 1;
          counts.set(text, (counts.get(text) ?? 0) + 1);
        }
        const topValues = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_VALUE_LIMIT)
          .map(([value, count]) => ({ value: value.slice(0, 40), count }));
        const sampled = rows.length;
        const scale =
          canSeeAllRows && sampled > 0 && recordCount > sampled
            ? recordCount / sampled
            : 1;
        return {
          id: field.id,
          name: field.name,
          type: field.type,
          nonEmpty: Math.round(nonEmpty * scale),
          empty: Math.round(empty * scale),
          topValues,
        };
      });

      digests.push({
        sheetId: sheet.id,
        sheetName: sheet.name,
        fieldCount: visibleFields.length,
        recordCount,
        fields,
      });
    }
    return digests;
  }

  async listReadableSheets(baseId: string, userId: string) {
    const sheets = await this.prisma.sheet.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    const readable: Array<{ id: string; name: string }> = [];
    for (const sheet of sheets) {
      try {
        await this.permissions.assertCan('sheet', sheet.id, userId, 'read');
        readable.push(sheet);
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ) {
          continue;
        }
        throw error;
      }
    }
    return readable;
  }
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'name' in item) {
          return String((item as { name: unknown }).name ?? '');
        }
        return String(item ?? '');
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object' && value && 'name' in value) {
    return String((value as { name: unknown }).name ?? '');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
