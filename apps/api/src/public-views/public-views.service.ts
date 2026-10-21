import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SharingService } from '../sharing/sharing.service';

@Injectable()
export class PublicViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly sharing: SharingService,
  ) {}

  async create(
    sheetId: string,
    userId: string,
    body: { name?: string; password?: string; expiresAt?: string | null },
  ) {
    const sheet = await this.assertEditor(sheetId, userId);
    const password = (body.password ?? '').trim();
    if (password && password.length < 4) {
      throw new BadRequestException('访问密码至少 4 位');
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('有效期时间无效');
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('有效期必须晚于当前时间');
      }
    }
    const created = await this.prisma.publicView.create({
      data: {
        sheetId,
        name: (body.name ?? sheet.name).trim() || sheet.name,
        token: randomBytes(18).toString('base64url'),
        passwordHash: password ? await hash(password) : null,
        expiresAt,
        createdBy: userId,
      },
    });
    return this.present(created);
  }

  async list(sheetId: string, userId: string) {
    await this.assertEditor(sheetId, userId);
    const views = await this.prisma.publicView.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'desc' },
    });
    return views.map((view) => this.present(view));
  }

  async remove(viewId: string, userId: string) {
    const view = await this.prisma.publicView.findUnique({
      where: { id: viewId },
    });
    if (!view) throw new NotFoundException('公开视图不存在');
    await this.assertEditor(view.sheetId, userId);
    await this.prisma.publicView.delete({ where: { id: viewId } });
    return { id: viewId, revoked: true };
  }

  async getPublic(token: string, password?: string) {
    const view = await this.requireView(token);
    if (view.passwordHash) {
      if (!password) {
        throw new UnauthorizedException('该公开视图需要访问密码');
      }
      const ok = await verify(view.passwordHash, password).catch(() => false);
      if (!ok) throw new ForbiddenException('访问密码错误');
    }
    return this.readData(view.id);
  }

  private async readData(viewId: string) {
    const view = await this.prisma.publicView.findUniqueOrThrow({
      where: { id: viewId },
      include: { sheet: true },
    });
    const fields = await this.prisma.field.findMany({
      where: { sheetId: view.sheetId, hidden: false },
      orderBy: { order: 'asc' },
    });
    const visibleIds = new Set(fields.map((field) => field.id));
    const records = await this.prisma.recordRow.findMany({
      where: { sheetId: view.sheetId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      readonly: true as const,
      name: view.name,
      sheet: { id: view.sheet.id, name: view.sheet.name },
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options,
        required: field.required,
      })),
      records: records.map((record) => {
        const cells: Record<string, unknown> = {};
        for (const [fieldId, value] of Object.entries(
          (record.cells ?? {}) as Record<string, unknown>,
        )) {
          if (visibleIds.has(fieldId)) cells[fieldId] = value;
        }
        return { id: record.id, cells };
      }),
      expiresAt: view.expiresAt,
    };
  }

  private async requireView(token: string) {
    const view = await this.prisma.publicView.findUnique({
      where: { token },
    });
    if (!view || !view.enabled) {
      throw new NotFoundException('公开视图不存在或已关闭');
    }
    if (view.expiresAt && view.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('公开视图已过期');
    }
    return view;
  }

  private async assertEditor(sheetId: string, userId: string) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    try {
      await this.workspaces.requireMember(
        sheet.base.workspaceId,
        userId,
        'editor',
      );
    } catch (error) {
      await this.sharing.assertAccess('sheet', sheetId, userId, 'editor');
    }
    return sheet;
  }

  private present(view: {
    id: string;
    sheetId: string;
    name: string;
    token: string;
    passwordHash: string | null;
    expiresAt: Date | null;
    enabled: boolean;
    createdAt: Date;
  }) {
    const base = (
      process.env.PUBLIC_FORM_BASE_URL ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    return {
      id: view.id,
      sheetId: view.sheetId,
      name: view.name,
      token: view.token,
      passwordRequired: Boolean(view.passwordHash),
      expiresAt: view.expiresAt,
      enabled: view.enabled,
      createdAt: view.createdAt,
      url: `${base}/view/${view.token}`,
    };
  }
}
