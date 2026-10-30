import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Field } from '@prisma/client';
import {
  evaluateFilterGroup,
  evaluateFormulaRows,
  type ColorRule,
  type FilterGroup,
  type ViewQuery,
} from 'shared';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SharingService } from '../sharing/sharing.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { buildFilterSql, buildSortSql } from '../automations/automation-filter.sql';
import type {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from './dto/saved-view.dto';

interface QueryRow {
  id: string;
  cells: Record<string, unknown>;
}

@Injectable()
export class ViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly permissions: PermissionsService,
    private readonly sharing: SharingService,
    private readonly live: LiveBusService,
  ) {}

  async query(sheetId: string, userId: string, query: ViewQuery) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: {
        base: true,
        fields: { orderBy: { order: 'asc' } },
      },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    try {
      await this.workspacesService.requireMember(
        sheet.base.workspaceId,
        userId,
        'viewer',
      );
    } catch (error) {
      await this.sharing.assertAccess('sheet', sheetId, userId, 'viewer');
    }
    const decision = await this.permissions.assertCan(
      'sheet',
      sheetId,
      userId,
      'read',
    );

    const fields = sheet.fields as Field[];
    const fieldMeta = fields.map((field) => ({
      id: field.id,
      type: field.type,
      options: field.options as {
        choices?: Array<{ id?: unknown; name?: unknown }>;
        aiComponent?: {
          gridContract?: {
            sortKey?: { path?: string; type?: string };
            filter?: { path?: string; valueType?: string };
          };
        };
      } | null,
    }));
    const where = query.filters
      ? buildFilterSql(query.filters, fieldMeta)
      : Prisma.sql`TRUE`;
    const searchRaw = (query.search ?? '').trim();
    const searchSql = searchRaw
      ? Prisma.sql`AND cells::text ILIKE ${`%${searchRaw.replace(/[%_\\]/g, '\\$&')}%`}`
      : Prisma.sql``;
    const order =
      query.sorts && query.sorts.length > 0
        ? buildSortSql(query.sorts, fieldMeta)
        : Prisma.sql`ORDER BY id ASC`;

    // 无分页截断：按视图排序一次取齐；Canvas 侧虚拟滚动承载渲染性能
    const rows = await this.prisma.$queryRaw<QueryRow[]>(
      Prisma.sql`SELECT id, cells FROM "records" WHERE "sheet_id" = ${sheetId}::uuid AND (${where}) ${searchSql} ${order}`,
    );

    const formulaValues = evaluateFormulaRows(
      fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options as { formula?: string } | null,
      })),
      rows,
    );
    const lookupValues = await this.resolveLookups(fields, rows);

    const records = rows.map((row, index) => ({
      id: row.id,
      cells: {
        ...row.cells,
        ...(formulaValues[index] ?? {}),
        ...(lookupValues[index] ?? {}),
      },
    }));

    const visibleRecords = this.permissions.applyReadScope(
      decision,
      records,
      userId,
    ) as typeof records;

    const colors: Record<string, string> = {};
    const cellColors: Record<string, Record<string, string>> = {};
    for (const record of visibleRecords) {
      for (const rule of query.colorRules ?? []) {
        if (!this.matchesColorRule(rule, record.cells)) continue;
        if (rule.scope === 'cell') {
          cellColors[record.id] = {
            ...(cellColors[record.id] ?? {}),
            [rule.fieldId]: rule.color,
          };
        } else {
          colors[record.id] = rule.color;
        }
      }
    }

    return {
      records: visibleRecords,
      total: visibleRecords.length,
      groups: this.buildGroups(visibleRecords, query.groups ?? [], fields),
      colors,
      cellColors,
      rowHeight: query.rowHeight ?? 'medium',
    };
  }

  async listSaved(sheetId: string, userId: string) {
    await this.requireSavedSheet(sheetId, userId, 'viewer');
    const views = await this.prisma.savedView.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'asc' },
    });
    return views.map((view) => ({
      id: view.id,
      sheetId: view.sheetId,
      name: view.name,
      query: (view.query ?? {}) as ViewQuery,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    }));
  }

  async createSaved(
    sheetId: string,
    userId: string,
    dto: CreateSavedViewDto,
  ) {
    const sheet = await this.requireSavedSheet(sheetId, userId, 'editor');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('视图名称不能为空');
    this.validateSavedQuery(dto.query);
    try {
      const view = await this.prisma.savedView.create({
        data: {
          sheetId,
          name,
          query: dto.query as Prisma.InputJsonValue,
          createdBy: userId,
        },
      });
      await this.emitViewChanged(sheet.baseId, sheetId, view.id, userId, 'create');
      return {
        id: view.id,
        sheetId: view.sheetId,
        name: view.name,
        query: view.query as ViewQuery,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('已存在同名视图');
      }
      throw error;
    }
  }

  async updateSaved(
    viewId: string,
    userId: string,
    dto: UpdateSavedViewDto,
  ) {
    const existing = await this.prisma.savedView.findUnique({
      where: { id: viewId },
    });
    if (!existing) throw new NotFoundException('视图不存在');
    const sheet = await this.requireSavedSheet(existing.sheetId, userId, 'editor');
    if (dto.query) this.validateSavedQuery(dto.query);
    try {
      const view = await this.prisma.savedView.update({
        where: { id: viewId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.query === undefined
            ? {}
            : { query: dto.query as Prisma.InputJsonValue }),
        },
      });
      await this.emitViewChanged(
        sheet.baseId,
        existing.sheetId,
        view.id,
        userId,
        'update',
      );
      return {
        id: view.id,
        sheetId: view.sheetId,
        name: view.name,
        query: view.query as ViewQuery,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('已存在同名视图');
      }
      throw error;
    }
  }

  async deleteSaved(viewId: string, userId: string) {
    const existing = await this.prisma.savedView.findUnique({
      where: { id: viewId },
    });
    if (!existing) throw new NotFoundException('视图不存在');
    const sheet = await this.requireSavedSheet(existing.sheetId, userId, 'editor');
    await this.prisma.savedView.delete({ where: { id: viewId } });
    await this.emitViewChanged(
      sheet.baseId,
      existing.sheetId,
      viewId,
      userId,
      'delete',
    );
    return { deleted: true };
  }

  private async emitViewChanged(
    baseId: string,
    sheetId: string,
    viewId: string,
    actorId: string,
    action: 'create' | 'update' | 'delete',
  ): Promise<void> {
    await this.live.emit({
      baseId,
      actorId,
      kind: 'view.changed',
      entityId: sheetId,
      meta: { viewId, action },
    });
  }

  private async requireSavedSheet(
    sheetId: string,
    userId: string,
    minimum: 'viewer' | 'editor',
  ) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    try {
      await this.workspacesService.requireMember(
        sheet.base.workspaceId,
        userId,
        minimum,
      );
    } catch (error) {
      await this.sharing.assertAccess('sheet', sheetId, userId, minimum);
    }
    return sheet;
  }

  private validateSavedQuery(query: Record<string, unknown>): void {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new BadRequestException('视图配置格式不正确');
    }
    const filters = query.filters as
      | { conjunction?: unknown; conditions?: unknown }
      | undefined;
    if (filters) {
      if (
        !['and', 'or'].includes(String(filters.conjunction ?? 'and')) ||
        !Array.isArray(filters.conditions)
      ) {
        throw new BadRequestException('筛选配置格式不正确');
      }
    }
    for (const key of ['sorts', 'groups', 'colorRules']) {
      const value = query[key];
      if (value !== undefined && !Array.isArray(value)) {
        throw new BadRequestException(`视图 ${key} 格式不正确`);
      }
    }
    if (
      query.search !== undefined &&
      (typeof query.search !== 'string' || query.search.length > 200)
    ) {
      throw new BadRequestException('视图 search 格式不正确');
    }
  }

  private matchesColorRule(
    rule: ColorRule,
    cells: Record<string, unknown>,
  ): boolean {
    const group: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { fieldId: rule.fieldId, operator: rule.operator, value: rule.value },
      ],
    };
    return evaluateFilterGroup(group, cells);
  }

  private buildGroups(
    records: Array<{ id: string; cells: Record<string, unknown> }>,
    specs: ViewQuery['groups'],
    fields: Field[],
  ) {
    if (!specs || specs.length === 0) return [];
    const groups: Array<{
      fieldId: string;
      key: string;
      label: string;
      count: number;
    }> = [];

    const walk = (
      rows: Array<{ id: string; cells: Record<string, unknown> }>,
      depth: number,
    ): void => {
      if (depth >= specs.length || rows.length === 0) return;
      const spec = specs[depth];
      const field = fields.find((item) => item.id === spec.fieldId);
      if (!field) return;
      const buckets = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = String(row.cells[field.id] ?? '');
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      for (const [key, bucket] of buckets.entries()) {
        groups.push({
          fieldId: field.id,
          key,
          label: this.displayValue(field, key),
          count: bucket.length,
        });
        walk(bucket, depth + 1);
      }
    };

    walk(records, 0);
    return groups;
  }

  private displayValue(field: Field, value: string): string {
    const choices = (
      field.options as {
        choices?: Array<{ id?: unknown; name?: unknown }>;
      } | null
    )?.choices;
    const choice = Array.isArray(choices)
      ? choices.find((item) => String(item.id) === value)
      : undefined;
    return String(choice?.name ?? value ?? '(空)') || '(空)';
  }

  /**
   * Resolve lookup fields: relation values -> target sheet cell, aggregated.
   * The values are computed for the response and never written back.
   */
  private async resolveLookups(
    fields: Field[],
    rows: QueryRow[],
  ): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = rows.map(() => ({}));
    const lookupFields = fields.filter((field) => field.type === 'lookup');

    for (const lookupField of lookupFields) {
      const config = (
        lookupField.options as {
          lookup?: {
            relationFieldId?: string;
            targetFieldId?: string;
            aggregate?: 'first' | 'count' | 'sum' | 'min' | 'max' | 'array';
          };
        } | null
      )?.lookup;
      if (!config?.relationFieldId || !config.targetFieldId) continue;

      const relationField = fields.find(
        (field) => field.id === config.relationFieldId,
      );
      const targetSheetId = (
        relationField?.options as {
          relation?: { targetSheetId?: string };
        } | null
      )?.relation?.targetSheetId;
      if (!targetSheetId) continue;

      const ids = new Set<string>();
      for (const row of rows) {
        const value = row.cells[config.relationFieldId];
        const list = Array.isArray(value) ? value : [value];
        for (const item of list) {
          if (typeof item === 'string' && item) ids.add(item);
        }
      }
      if (ids.size === 0) continue;

      const targets = await this.prisma.recordRow.findMany({
        where: { id: { in: [...ids] } },
      });
      const byId = new Map(
        targets.map((record) => [
          record.id,
          (record.cells as Record<string, unknown>)[config.targetFieldId!],
        ]),
      );

      rows.forEach((row, index) => {
        const value = row.cells[config.relationFieldId!];
        const list = (Array.isArray(value) ? value : [value])
          .filter((item): item is string => typeof item === 'string' && !!item)
          .map((item) => byId.get(item))
          .filter((item) => item !== undefined && item !== null);
        results[index][lookupField.id] = this.aggregate(
          list,
          config.aggregate ?? 'first',
        );
      });
    }

    return results;
  }

  private aggregate(
    values: unknown[],
    mode: 'first' | 'count' | 'sum' | 'min' | 'max' | 'array',
  ): unknown {
    if (mode === 'count') return values.length;
    if (mode === 'array') return values;
    if (values.length === 0) return '';
    if (mode === 'first') return values[0];
    const numbers = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (numbers.length === 0) return '';
    if (mode === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
    if (mode === 'min') return Math.min(...numbers);
    return Math.max(...numbers);
  }
}
