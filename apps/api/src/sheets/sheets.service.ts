import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import {
  isSystemFieldType,
  resolveRecordPageLimit,
  type FieldType,
} from 'shared';
import { AutomationRunnerService } from '../automations/automation-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SharingService } from '../sharing/sharing.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AuditService } from '../audit/audit.service';
import { QuotasService } from '../quotas/quotas.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateFieldDto } from './dto/create-field.dto';
import type { ListRecordsQueryDto } from './dto/list-records.query';
import type { UpdateFieldDto } from './dto/update-field.dto';
import { applyAutoNumbers, stripAutoNumberInputs } from './auto-number';
import { applyAiFields, stripAiFieldInputs } from './ai-field';
import { seedBlankSheetStructure } from './blank-sheet';

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly automationRunner: AutomationRunnerService,
    private readonly permissions: PermissionsService,
    private readonly sharing: SharingService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly quotas: QuotasService,
  ) {}

  private async requireBase(
    baseId: string,
    userId: string,
    minimum: WorkspaceRole,
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    try {
      await this.workspacesService.requireMember(
        base.workspaceId,
        userId,
        minimum,
      );
    } catch (error) {
      await this.sharing.assertAccess('base', baseId, userId, minimum);
    }
    return base;
  }

  private async requireSheet(
    sheetId: string,
    userId: string,
    minimum: WorkspaceRole,
  ) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) {
      throw new NotFoundException('工作表不存在');
    }
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

  async assertSheetAccess(
    sheetId: string,
    userId: string,
    minimum: WorkspaceRole,
  ) {
    return this.requireSheet(sheetId, userId, minimum);
  }

  async createSheet(
    baseId: string,
    userId: string,
    name: string,
    options?: { seed?: boolean },
  ) {
    await this.requireBase(baseId, userId, 'editor');
    const seed = options?.seed !== false;
    return this.prisma.$transaction(async (tx) => {
      const sheet = await tx.sheet.create({
        data: { baseId, name: name.trim() },
      });
      if (seed) {
        await seedBlankSheetStructure(tx, sheet.id, userId);
      }
      const fields = await tx.field.findMany({
        where: { sheetId: sheet.id },
        orderBy: { order: 'asc' },
      });
      return { ...sheet, fields };
    });
  }

  async listByBase(baseId: string, userId: string) {
    await this.requireBase(baseId, userId, 'viewer');
    const accessible = await this.sharing.accessibleSheetIds(baseId, userId);
    return this.prisma.sheet.findMany({
      where: {
        baseId,
        ...(accessible === null ? {} : { id: { in: accessible } }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getSheet(sheetId: string, userId: string) {
    const sheet = await this.requireSheet(sheetId, userId, 'viewer');
    const decision = await this.permissions.assertCan(
      'sheet',
      sheetId,
      userId,
      'read',
    );
    const fields = await this.prisma.field.findMany({
      where: { sheetId },
      orderBy: { order: 'asc' },
    });

    return {
      id: sheet.id,
      baseId: sheet.baseId,
      name: sheet.name,
      createdAt: sheet.createdAt,
      updatedAt: sheet.updatedAt,
      fields: this.permissions.filterVisibleFields(decision, fields),
    };
  }

  async renameSheet(sheetId: string, userId: string, name: string) {
    await this.requireSheet(sheetId, userId, 'editor');
    return this.prisma.sheet.update({
      where: { id: sheetId },
      data: { name: name.trim() },
    });
  }

  async deleteSheet(sheetId: string, userId: string) {
    await this.requireSheet(sheetId, userId, 'editor');
    await this.prisma.sheet.delete({ where: { id: sheetId } });
    void this.audit.recordSheet(sheetId, userId, 'sheet.deleted', sheetId, {});
    return { id: sheetId, deleted: true };
  }

  async deleteField(fieldId: string, userId: string) {
    const field = await this.prisma.field.findUnique({
      where: { id: fieldId },
      include: { sheet: { include: { base: true } } },
    });
    if (!field) {
      throw new NotFoundException('字段不存在');
    }
    await this.requireSheet(field.sheetId, userId, 'editor');
    if (isSystemFieldType(field.type as FieldType)) {
      throw new BadRequestException('系统字段不能删除');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.field.delete({ where: { id: fieldId } });
      // Remove the deleted field from every record so exports stay clean.
      await tx.$executeRaw`
        UPDATE "records"
        SET "cells" = "cells" - ${fieldId}::text,
            "version" = "version" + 1
        WHERE "sheet_id" = ${field.sheetId}::uuid
          AND "cells" ? ${fieldId}::text
      `;
    });
    return { id: fieldId, deleted: true };
  }

  async uploadAttachment(
    sheetId: string,
    userId: string,
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ) {
    const sheet = await this.requireSheet(sheetId, userId, 'editor');
    await this.quotas.assertStorage(sheet.base.workspaceId, buffer.byteLength);
    const saved = await this.storage.saveUpload(
      buffer,
      mimetype,
      originalName,
    );
    await this.quotas.recordStorage(
      sheet.base.workspaceId,
      saved.key,
      saved.size,
    );
    return {
      url: saved.url,
      name: saved.name,
      mimetype: saved.mimetype,
      size: saved.size,
    };
  }

  async createField(sheetId: string, userId: string, dto: CreateFieldDto) {
    await this.requireSheet(sheetId, userId, 'editor');

    const order =
      dto.order ?? (await this.prisma.field.count({ where: { sheetId } }));

    return this.prisma.field.create({
      data: {
        sheetId,
        name: dto.name.trim(),
        type: dto.type,
        order,
        required: dto.required ?? false,
        hidden: dto.hidden ?? false,
        ...(dto.options === undefined
          ? {}
          : { options: dto.options as Prisma.InputJsonValue }),
      },
    });
  }

  async updateField(fieldId: string, userId: string, dto: UpdateFieldDto) {
    const field = await this.prisma.field.findUnique({
      where: { id: fieldId },
      include: { sheet: { include: { base: true } } },
    });
    if (!field) {
      throw new NotFoundException('字段不存在');
    }
    await this.requireSheet(
      field.sheetId,
      userId,
      'editor',
    );

    return this.prisma.field.update({
      where: { id: fieldId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.hidden === undefined ? {} : { hidden: dto.hidden }),
        ...(dto.required === undefined ? {} : { required: dto.required }),
        ...(dto.order === undefined ? {} : { order: dto.order }),
        ...(dto.options === undefined
          ? {}
          : { options: dto.options as Prisma.InputJsonValue }),
      },
    });
  }

  async createRecord(
    sheetId: string,
    userId: string,
    cells: Record<string, unknown>,
  ) {
    const decision = await this.permissions.assertCan(
      'sheet',
      sheetId,
      userId,
      'create',
      { changes: cells },
    );
    await this.assertKnownFields(sheetId, cells);

    const record = await this.prisma.$transaction(async (tx) => {
      const strippedNumbers = await stripAutoNumberInputs(tx, sheetId, cells);
      const stripped = await stripAiFieldInputs(tx, sheetId, strippedNumbers);
      const withNumbers = await applyAutoNumbers(tx, sheetId, stripped);
      const withAi = await applyAiFields(tx, sheetId, withNumbers);
      const fields = await tx.field.findMany({
        where: { sheetId },
        select: { id: true, name: true, options: true },
      });
      return tx.recordRow.create({
        data: {
          sheetId,
          cells: withAi as Prisma.InputJsonValue,
          claimStatus: this.claimStatusFor(fields, withAi),
          createdBy: userId,
        },
      });
    });

    try {
      await this.automationRunner.triggerRecordCreated(record.id);
    } catch (error) {
      this.logger.error(
        `automation trigger failed for record ${record.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    void this.webhooks
      .emitForSheet(sheetId, 'record.created', {
        recordId: record.id,
        cells: record.cells,
        createdBy: record.createdBy,
      })
      .catch((error: unknown) => {
        this.logger.warn(`webhook record.created failed: ${String(error)}`);
      });
    void this.audit.recordSheet(
      sheetId,
      userId,
      'record.created',
      record.id,
      { cells: record.cells },
    );

    return record;
  }

  async deleteRecord(recordId: string, userId: string) {
    const record = await this.prisma.recordRow.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('记录不存在');
    await this.permissions.assertCan(
      'sheet',
      record.sheetId,
      userId,
      'delete',
      {
        record: {
          id: record.id,
          cells: (record.cells ?? {}) as Record<string, unknown>,
          createdBy: record.createdBy,
        },
      },
    );
    await this.prisma.recordRow.delete({ where: { id: recordId } });
    void this.webhooks
      .emitForSheet(record.sheetId, 'record.deleted', {
        recordId,
        cells: record.cells,
      })
      .catch((error: unknown) => {
        this.logger.warn(`webhook record.deleted failed: ${String(error)}`);
      });
    void this.audit.recordSheet(
      record.sheetId,
      userId,
      'record.deleted',
      recordId,
      { cells: record.cells },
    );
    return { id: recordId, deleted: true };
  }

  async updateRecord(
    recordId: string,
    userId: string,
    cells: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const record = await this.prisma.recordRow.findUnique({
      where: { id: recordId },
    });
    if (!record) {
      throw new NotFoundException('记录不存在');
    }

    await this.permissions.assertCan(
      'sheet',
      record.sheetId,
      userId,
      'update',
      {
        record: {
          id: record.id,
          cells: (record.cells ?? {}) as Record<string, unknown>,
          createdBy: record.createdBy,
        },
        changes: cells,
      },
    );
    const strippedNumbers = await stripAutoNumberInputs(
      this.prisma,
      record.sheetId,
      cells,
    );
    const stripped = await stripAiFieldInputs(
      this.prisma,
      record.sheetId,
      strippedNumbers,
    );
    const fields = await this.assertKnownFields(record.sheetId, stripped);

    const currentCells = (record.cells ?? {}) as Record<string, unknown>;
    const mergedCells = await applyAiFields(
      this.prisma,
      record.sheetId,
      { ...currentCells, ...stripped },
      currentCells,
    );
    const claimStatus = this.claimStatusFor(fields, mergedCells);

    let updatedRecord;
    if (expectedVersion === undefined) {
      updatedRecord = await this.prisma.recordRow.update({
        where: { id: recordId },
        data: {
          cells: mergedCells as Prisma.InputJsonValue,
          version: { increment: 1 },
          claimStatus,
        },
      });
    } else {
      const updated = await this.prisma.recordRow.updateMany({
        where: { id: recordId, version: expectedVersion },
        data: {
          cells: mergedCells as Prisma.InputJsonValue,
          version: { increment: 1 },
          claimStatus,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException('记录已被他人修改，请刷新后重试');
      }
      updatedRecord = await this.prisma.recordRow.findUniqueOrThrow({
        where: { id: recordId },
      });
    }

    void this.webhooks
      .emitForSheet(record.sheetId, 'record.updated', {
        recordId,
        cells: updatedRecord.cells,
        changes: cells,
      })
      .catch((error: unknown) => {
        this.logger.warn(`webhook record.updated failed: ${String(error)}`);
      });
    void this.audit.recordSheet(
      record.sheetId,
      userId,
      'record.updated',
      recordId,
      { changes: cells, version: updatedRecord.version },
    );

    try {
      await this.automationRunner.triggerRecordUpdated(recordId);
    } catch (error) {
      this.logger.error(
        `automation update trigger failed for record ${recordId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return updatedRecord;
  }

  async listRecords(
    sheetId: string,
    userId: string,
    query: ListRecordsQueryDto,
  ) {
    await this.requireSheet(sheetId, userId, 'viewer');
    const decision = await this.permissions.assertCan(
      'sheet',
      sheetId,
      userId,
      'read',
    );

    const take = resolveRecordPageLimit(query.limit);
    const rows = await this.prisma.recordRow.findMany({
      where: {
        sheetId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const records = hasMore ? rows.slice(0, take) : rows;

    return {
      records: this.permissions.applyReadScope(decision, records, userId),
      nextCursor:
        hasMore && records.length > 0
          ? records[records.length - 1].id
          : null,
    };
  }

  private async assertKnownFields(
    sheetId: string,
    cells: Record<string, unknown>,
  ): Promise<Array<{ id: string; name: string; options: unknown }>> {
    const keys = Object.keys(cells);
    if (keys.length === 0) return [];

    const fields = await this.prisma.field.findMany({
      where: { sheetId },
      select: { id: true, name: true, options: true },
    });
    const known = new Set(fields.map((field) => field.id));
    const unknown = keys.filter((key) => !known.has(key));

    if (unknown.length > 0) {
      throw new BadRequestException(`未知字段: ${unknown.join(', ')}`);
    }
    return fields;
  }

  private claimStatusFor(
    fields: Array<{ id: string; name: string; options: unknown }>,
    cells: Record<string, unknown>,
  ): string | null {
    const statusField = fields.find(
      (field) => field.name === '状态' || field.name === '领取状态',
    );
    if (!statusField) return null;

    const raw = String(cells[statusField.id] ?? '').trim();
    if (!raw) return null;

    const choices = (
      statusField.options as {
        choices?: Array<{ id?: unknown; name?: unknown }>;
      } | null
    )?.choices;
    const choice = Array.isArray(choices)
      ? choices.find((item) => item.id === raw || item.name === raw)
      : undefined;
    const normalized = String(choice?.name ?? raw);

    if (['unclaimed', '未领', '未领取', '待领取'].includes(normalized)) {
      return 'unclaimed';
    }
    if (['claimed', '已领', '已领取'].includes(normalized)) {
      return 'claimed';
    }
    return null;
  }
}
