import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  bases: Array<{ id: string; name: string }>;
  children: FolderNode[];
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async tree(workspaceId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId, 'viewer');
    const [folders, bases] = await Promise.all([
      this.prisma.folder.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.base.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, folderId: true },
      }),
    ]);

    const nodes = new Map<string, FolderNode>();
    for (const folder of folders) {
      nodes.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        bases: [],
        children: [],
      });
    }
    const roots: FolderNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const unfiled: Array<{ id: string; name: string }> = [];
    for (const base of bases) {
      if (base.folderId && nodes.has(base.folderId)) {
        nodes.get(base.folderId)!.bases.push({
          id: base.id,
          name: base.name,
        });
      } else {
        unfiled.push({ id: base.id, name: base.name });
      }
    }
    return { folders: roots, unfiled };
  }

  async create(
    workspaceId: string,
    userId: string,
    body: { name: string; parentId?: string | null },
  ) {
    await this.workspaces.requireMember(workspaceId, userId, 'editor');
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('文件夹名称不能为空');
    if (body.parentId) {
      await this.assertFolder(body.parentId, workspaceId);
      await this.assertDepth(body.parentId, workspaceId, 1);
    }
    return this.prisma.folder.create({
      data: { workspaceId, name, parentId: body.parentId ?? null },
    });
  }

  async update(
    folderId: string,
    userId: string,
    body: { name?: string; parentId?: string | null },
  ) {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('文件夹不存在');
    await this.workspaces.requireMember(
      folder.workspaceId,
      userId,
      'editor',
    );
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === folderId) {
        throw new BadRequestException('不能把文件夹移动到自身');
      }
      await this.assertFolder(body.parentId, folder.workspaceId);
      await this.assertNoCycle(folderId, body.parentId, folder.workspaceId);
      await this.assertDepth(body.parentId, folder.workspaceId, 1);
    }
    return this.prisma.folder.update({
      where: { id: folderId },
      data: {
        ...(body.name === undefined ? {} : { name: body.name.trim() }),
        ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
      },
    });
  }

  async remove(folderId: string, userId: string) {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('文件夹不存在');
    await this.workspaces.requireMember(
      folder.workspaceId,
      userId,
      'editor',
    );
    await this.prisma.$transaction([
      this.prisma.folder.updateMany({
        where: { parentId: folder.id },
        data: { parentId: folder.parentId },
      }),
      this.prisma.base.updateMany({
        where: { folderId: folder.id },
        data: { folderId: folder.parentId },
      }),
      this.prisma.folder.delete({ where: { id: folder.id } }),
    ]);
    return { id: folderId, deleted: true };
  }

  async moveBase(
    baseId: string,
    userId: string,
    folderId: string | null,
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.workspaces.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );
    if (folderId) await this.assertFolder(folderId, base.workspaceId);
    return this.prisma.base.update({
      where: { id: baseId },
      data: { folderId },
      select: { id: true, name: true, folderId: true },
    });
  }

  private async assertFolder(folderId: string, workspaceId: string) {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder || folder.workspaceId !== workspaceId) {
      throw new BadRequestException('目标文件夹不存在');
    }
  }

  private async assertNoCycle(
    folderId: string,
    parentId: string,
    workspaceId: string,
  ) {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === folderId) {
        throw new BadRequestException('文件夹层级不能成环');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent: { parentId: string | null; workspaceId: string } | null =
        await this.prisma.folder.findUnique({
          where: { id: cursor },
          select: { parentId: true, workspaceId: true },
        });
      if (!parent || parent.workspaceId !== workspaceId) break;
      cursor = parent.parentId;
    }
  }

  private async assertDepth(
    parentId: string,
    workspaceId: string,
    depth: number,
  ) {
    let cursor: string | null = parentId;
    let level = depth;
    while (cursor) {
      if (level > 8) throw new BadRequestException('文件夹最多嵌套 8 层');
      const parent: { parentId: string | null; workspaceId: string } | null =
        await this.prisma.folder.findUnique({
          where: { id: cursor },
          select: { parentId: true, workspaceId: true },
        });
      if (!parent || parent.workspaceId !== workspaceId) break;
      cursor = parent.parentId;
      level += 1;
    }
  }
}
