import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SharingService } from '../sharing/sharing.service';
import { seedBlankSheetStructure } from '../sheets/blank-sheet';

@Injectable()
export class BasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly sharing: SharingService,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    name: string,
    description?: string | null,
  ) {
    await this.workspacesService.requireMember(workspaceId, userId, 'editor');
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('名称不能为空');
    }
    await this.assertNameAvailable(workspaceId, trimmed);
    const desc = normalizeDescription(description);
    return this.prisma.$transaction(async (tx) => {
      const max = await tx.base.aggregate({
        where: { workspaceId },
        _max: { sortOrder: true },
      });
      const sortOrder = (max._max.sortOrder ?? -1) + 1;
      const base = await tx.base.create({
        data: {
          workspaceId,
          name: trimmed,
          description: desc,
          sortOrder,
        },
      });
      const sheet = await tx.sheet.create({
        data: { baseId: base.id, name: '表格' },
      });
      await seedBlankSheetStructure(tx, sheet.id, userId);
      return base;
    });
  }

  async list(workspaceId: string, userId: string) {
    await this.workspacesService.requireMember(workspaceId, userId, 'viewer');
    const [own, shared] = await Promise.all([
      this.prisma.base.findMany({
        where: { workspaceId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.sharing.sharedBases(workspaceId, userId),
    ]);
    const seen = new Set(own.map((base) => base.id));
    return [...own, ...shared.filter((base) => !seen.has(base.id))];
  }

  async getDetail(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    try {
      await this.workspacesService.requireMember(
        base.workspaceId,
        userId,
        'viewer',
      );
    } catch (error) {
      await this.sharing.assertAccess('base', baseId, userId, 'viewer');
    }
    return base;
  }

  async update(
    baseId: string,
    userId: string,
    body: { name?: string; description?: string | null },
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );
    const data: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('名称不能为空');
      await this.assertNameAvailable(base.workspaceId, name, baseId);
      data.name = name;
    }
    if (body.description !== undefined) {
      data.description = normalizeDescription(body.description);
    }
    if (!Object.keys(data).length) {
      throw new BadRequestException('没有可更新的字段');
    }
    return this.prisma.base.update({
      where: { id: baseId },
      data,
    });
  }

  async remove(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );
    await this.prisma.base.delete({ where: { id: baseId } });
    return { id: baseId, deleted: true };
  }

  async moveToWorkspace(
    baseId: string,
    userId: string,
    targetWorkspaceId: string,
  ) {
    const workspaceId = (targetWorkspaceId ?? '').trim();
    if (!workspaceId) {
      throw new BadRequestException('目标工作区不能为空');
    }
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    if (base.workspaceId === workspaceId) {
      throw new BadRequestException('已在该工作区');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );
    await this.workspacesService.requireMember(workspaceId, userId, 'editor');
    await this.assertNameAvailable(workspaceId, base.name, undefined, {
      moveConflict: true,
    });

    return this.prisma.$transaction(async (tx) => {
      const max = await tx.base.aggregate({
        where: { workspaceId },
        _max: { sortOrder: true },
      });
      const sortOrder = (max._max.sortOrder ?? -1) + 1;
      return tx.base.update({
        where: { id: baseId },
        data: { workspaceId, sortOrder },
      });
    });
  }

  /** 同一工作区内表格名称不可重复（大小写不敏感）。 */
  async assertNameAvailable(
    workspaceId: string,
    name: string,
    excludeBaseId?: string,
    options?: { moveConflict?: boolean },
  ): Promise<void> {
    const rows = await this.prisma.base.findMany({
      where: {
        workspaceId,
        ...(excludeBaseId ? { id: { not: excludeBaseId } } : {}),
      },
      select: { id: true, name: true },
    });
    const needle = name.trim().toLowerCase();
    const clash = rows.find(
      (item) => item.name.trim().toLowerCase() === needle,
    );
    if (!clash) return;
    if (options?.moveConflict) {
      throw new ConflictException(
        `目标工作区已有同名表格「${clash.name}」，请先改名后再移动`,
      );
    }
    throw new ConflictException(`当前工作区已存在同名表格「${clash.name}」`);
  }

  async reorder(
    workspaceId: string,
    userId: string,
    orderedIds: string[],
  ) {
    await this.workspacesService.requireMember(workspaceId, userId, 'editor');
    const ids = Array.isArray(orderedIds)
      ? orderedIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];
    if (!ids.length) {
      throw new BadRequestException('orderedIds 不能为空');
    }

    const owned = await this.prisma.base.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((item) => item.id));
    if (ids.length !== ownedSet.size || ids.some((id) => !ownedSet.has(id))) {
      throw new BadRequestException('排序列表必须覆盖本工作区全部表格');
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.base.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.list(workspaceId, userId);
  }
}

function normalizeDescription(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
