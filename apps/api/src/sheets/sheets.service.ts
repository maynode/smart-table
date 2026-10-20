import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { resolveRecordPageLimit } from 'shared';
import { AutomationRunnerService } from '../automations/automation-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateFieldDto } from './dto/create-field.dto';
import type { ListRecordsQueryDto } from './dto/list-records.query';
import type { UpdateFieldDto } from './dto/update-field.dto';

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly automationRunner: AutomationRunnerService,
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
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      minimum,
    );
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
    await this.workspacesService.requireMember(
      sheet.base.workspaceId,
      userId,
      minimum,
    );
    return sheet;
  }

  async assertSheetAccess(
    sheetId: string,
    userId: string,
    minimum: WorkspaceRole,
  ) {
    return this.requireSheet(sheetId, userId, minimum);
  }

  async createSheet(baseId: string, userId: string, name: string) {
    await this.requireBase(baseId, userId, 'editor');
    return this.prisma.sheet.create({
      data: { baseId, name: name.trim() },
    });
  }

  async listByBase(baseId: string, userId: string) {
    await this.requireBase(baseId, userId, 'viewer');
    return this.prisma.sheet.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getSheet(sheetId: string, userId: string) {
    const sheet = await this.requireSheet(sheetId, userId, 'viewer');
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
      fields,
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
    await this.workspacesService.requireMember(
      field.sheet.base.workspaceId,
      userId,
      'editor',
    );

    return this.prisma.field.update({
      where: { id: fieldId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
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
    await this.requireSheet(sheetId, userId, 'editor');
    await this.assertKnownFields(sheetId, cells);

    const record = await this.prisma.recordRow.create({
      data: { sheetId, cells: cells as Prisma.InputJsonValue },
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

    return record;
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

    await this.requireSheet(record.sheetId, userId, 'editor');
    await this.assertKnownFields(record.sheetId, cells);

    const currentCells = (record.cells ?? {}) as Record<string, unknown>;
    const mergedCells = { ...currentCells, ...cells };

    if (expectedVersion === undefined) {
      return this.prisma.recordRow.update({
        where: { id: recordId },
        data: {
          cells: mergedCells as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    }

    const updated = await this.prisma.recordRow.updateMany({
      where: { id: recordId, version: expectedVersion },
      data: {
        cells: mergedCells as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException('记录已被他人修改，请刷新后重试');
    }

    return this.prisma.recordRow.findUniqueOrThrow({
      where: { id: recordId },
    });
  }

  async listRecords(
    sheetId: string,
    userId: string,
    query: ListRecordsQueryDto,
  ) {
    await this.requireSheet(sheetId, userId, 'viewer');

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
      records,
      nextCursor:
        hasMore && records.length > 0
          ? records[records.length - 1].id
          : null,
    };
  }

  private async assertKnownFields(
    sheetId: string,
    cells: Record<string, unknown>,
  ): Promise<void> {
    const keys = Object.keys(cells);
    if (keys.length === 0) return;

    const fields = await this.prisma.field.findMany({
      where: { sheetId },
      select: { id: true },
    });
    const known = new Set(fields.map((field) => field.id));
    const unknown = keys.filter((key) => !known.has(key));

    if (unknown.length > 0) {
      throw new BadRequestException(`未知字段: ${unknown.join(', ')}`);
    }
  }
}
