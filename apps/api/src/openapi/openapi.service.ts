import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { ApiKeysService, type ApiScope } from '../api-keys/api-keys.service';
import type { OpenApiKey } from '../api-keys/api-key.guard';

@Injectable()
export class OpenApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async listBases(workspaceId: string, key: OpenApiKey) {
    this.assertWorkspace(workspaceId, key);
    this.apiKeys.assertScope(key.scopes, 'read');
    return this.prisma.base.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createBase(workspaceId: string, key: OpenApiKey, name: string) {
    this.assertWorkspace(workspaceId, key);
    this.apiKeys.assertScope(key.scopes, 'write');
    if (!name?.trim()) throw new BadRequestException('Base 名称不能为空');
    return this.prisma.base.create({
      data: { workspaceId, name: name.trim() },
    });
  }

  async getBase(baseId: string, key: OpenApiKey) {
    this.apiKeys.assertScope(key.scopes, 'read');
    const base = await this.requireBase(baseId, key);
    return base;
  }

  async listSheets(baseId: string, key: OpenApiKey) {
    this.apiKeys.assertScope(key.scopes, 'read');
    await this.requireBase(baseId, key);
    return this.prisma.sheet.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createSheet(baseId: string, key: OpenApiKey, name: string) {
    this.apiKeys.assertScope(key.scopes, 'write');
    await this.requireBase(baseId, key);
    if (!name?.trim()) throw new BadRequestException('工作表名称不能为空');
    return this.prisma.sheet.create({
      data: { baseId, name: name.trim() },
    });
  }

  async listFields(sheetId: string, key: OpenApiKey) {
    this.apiKeys.assertScope(key.scopes, 'read');
    await this.requireSheet(sheetId, key);
    return this.prisma.field.findMany({
      where: { sheetId },
      orderBy: { order: 'asc' },
    });
  }

  async createField(
    sheetId: string,
    key: OpenApiKey,
    body: {
      name: string;
      type: string;
      required?: boolean;
      options?: Record<string, unknown>;
    },
  ) {
    this.apiKeys.assertScope(key.scopes, 'write');
    await this.requireSheet(sheetId, key);
    const actor = await this.actor(key);
    return this.sheets.createField(sheetId, actor, {
      ...body,
      type: body.type as never,
    });
  }

  async listRecords(
    sheetId: string,
    key: OpenApiKey,
    query: { limit?: string; cursor?: string },
  ) {
    this.apiKeys.assertScope(key.scopes, 'read');
    await this.requireSheet(sheetId, key);
    const actor = await this.actor(key);
    return this.sheets.listRecords(sheetId, actor, {
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }

  async createRecord(
    sheetId: string,
    key: OpenApiKey,
    cells: Record<string, unknown>,
  ) {
    this.apiKeys.assertScope(key.scopes, 'write');
    await this.requireSheet(sheetId, key);
    const actor = await this.actor(key);
    return this.sheets.createRecord(sheetId, actor, cells ?? {});
  }

  async updateRecord(
    recordId: string,
    key: OpenApiKey,
    body: { cells: Record<string, unknown>; expectedVersion?: number },
  ) {
    this.apiKeys.assertScope(key.scopes, 'write');
    const record = await this.prisma.recordRow.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('记录不存在');
    await this.requireSheet(record.sheetId, key);
    const actor = await this.actor(key);
    return this.sheets.updateRecord(
      recordId,
      actor,
      body.cells ?? {},
      body.expectedVersion,
    );
  }

  async deleteRecord(recordId: string, key: OpenApiKey) {
    this.apiKeys.assertScope(key.scopes, 'write');
    const record = await this.prisma.recordRow.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('记录不存在');
    await this.requireSheet(record.sheetId, key);
    const actor = await this.actor(key);
    return this.sheets.deleteRecord(recordId, actor);
  }

  async listForms(baseId: string, key: OpenApiKey) {
    this.apiKeys.assertScope(key.scopes, 'read');
    await this.requireBase(baseId, key);
    return this.prisma.form.findMany({
      where: { baseId },
      select: {
        id: true,
        name: true,
        sheetId: true,
        shareToken: true,
        createdAt: true,
      },
    });
  }

  private assertWorkspace(workspaceId: string, key: OpenApiKey) {
    if (key.workspaceId !== workspaceId) {
      throw new ForbiddenException('API Key 不属于该工作区');
    }
  }

  private async requireBase(baseId: string, key: OpenApiKey) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    this.assertWorkspace(base.workspaceId, key);
    return base;
  }

  private async requireSheet(sheetId: string, key: OpenApiKey) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    this.assertWorkspace(sheet.base.workspaceId, key);
    return sheet;
  }

  private async actor(key: OpenApiKey): Promise<string> {
    if (key.createdBy) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: key.workspaceId,
            userId: key.createdBy,
          },
        },
      });
      if (member) return member.userId;
    }
    const owner = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: key.workspaceId, role: 'owner' },
    });
    if (!owner) throw new ForbiddenException('工作区没有可用的服务身份');
    return owner.userId;
  }
}
