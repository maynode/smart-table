import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { roleAtLeast } from '../workspaces/workspace-roles';

export interface SharedAccess {
  role: WorkspaceRole;
  baseId: string;
  sourceWorkspaceId: string;
  shareId: string;
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(
    sourceWorkspaceId: string,
    userId: string,
    body: {
      targetWorkspaceId: string;
      objectType: 'base' | 'sheet';
      objectId: string;
      role: 'view' | 'edit';
    },
  ) {
    await this.workspaces.requireMember(sourceWorkspaceId, userId, 'admin');
    if (body.targetWorkspaceId === sourceWorkspaceId) {
      throw new BadRequestException('不能共享给当前工作区');
    }
    if (!['base', 'sheet'].includes(body.objectType)) {
      throw new BadRequestException('共享对象类型无效');
    }
    if (!['view', 'edit'].includes(body.role)) {
      throw new BadRequestException('共享角色需为 view 或 edit');
    }
    const target = await this.prisma.workspace.findUnique({
      where: { id: body.targetWorkspaceId },
    });
    if (!target) throw new NotFoundException('目标工作区不存在');

    const object = await this.resolveObject(
      body.objectType,
      body.objectId,
      sourceWorkspaceId,
    );
    const existing = await this.prisma.crossWorkspaceShare.findUnique({
      where: {
        objectType_objectId_targetWorkspaceId: {
          objectType: body.objectType,
          objectId: body.objectId,
          targetWorkspaceId: body.targetWorkspaceId,
        },
      },
    });
    if (existing) throw new ConflictException('该对象已共享给目标工作区');

    return this.prisma.crossWorkspaceShare.create({
      data: {
        sourceWorkspaceId,
        targetWorkspaceId: body.targetWorkspaceId,
        objectType: body.objectType,
        objectId: body.objectId,
        role: body.role,
        createdBy: userId,
      },
    });
  }

  async list(workspaceId: string, userId: string, direction: 'in' | 'out') {
    await this.workspaces.requireMember(workspaceId, userId, 'viewer');
    const shares = await this.prisma.crossWorkspaceShare.findMany({
      where:
        direction === 'out'
          ? { sourceWorkspaceId: workspaceId }
          : { targetWorkspaceId: workspaceId },
      include: {
        sourceWorkspace: { select: { id: true, name: true } },
        targetWorkspace: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const result = [];
    for (const share of shares) {
      const name =
        share.objectType === 'sheet'
          ? (await this.prisma.sheet.findUnique({
              where: { id: share.objectId },
              select: { name: true },
            }))?.name
          : (
              await this.prisma.base.findUnique({
                where: { id: share.objectId },
                select: { name: true },
              })
            )?.name;
      result.push({
        id: share.id,
        objectType: share.objectType,
        objectId: share.objectId,
        objectName: name ?? '已删除对象',
        role: share.role,
        sourceWorkspaceId: share.sourceWorkspaceId,
        sourceWorkspaceName: share.sourceWorkspace.name,
        targetWorkspaceId: share.targetWorkspaceId,
        targetWorkspaceName: share.targetWorkspace.name,
        createdAt: share.createdAt,
      });
    }
    return result;
  }

  async revoke(shareId: string, userId: string) {
    const share = await this.prisma.crossWorkspaceShare.findUnique({
      where: { id: shareId },
    });
    if (!share) throw new NotFoundException('共享不存在');
    const source = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: share.sourceWorkspaceId,
          userId,
        },
      },
    });
    if (!source || source.role !== 'owner') {
      await this.workspaces.requireMember(
        share.targetWorkspaceId,
        userId,
        'admin',
      );
    }
    await this.prisma.crossWorkspaceShare.delete({ where: { id: shareId } });
    return { id: shareId, revoked: true };
  }

  async roleForObject(
    objectType: 'base' | 'sheet',
    objectId: string,
    userId: string,
  ): Promise<SharedAccess | null> {
    const object = await this.resolveObject(objectType, objectId);
    if (!object) return null;
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: object.sourceWorkspaceId,
          userId,
        },
      },
    });
    if (membership) return null;

    const sheetIds =
      objectType === 'base'
        ? (
            await this.prisma.sheet.findMany({
              where: { baseId: objectId },
              select: { id: true },
            })
          ).map((sheet) => sheet.id)
        : [];
    const shares = await this.prisma.crossWorkspaceShare.findMany({
      where: {
        targetWorkspace: { members: { some: { userId } } },
        OR: [
          { objectType, objectId },
          ...(object.baseId
            ? [{ objectType: 'base', objectId: object.baseId }]
            : []),
          ...sheetIds.map((id) => ({ objectType: 'sheet', objectId: id })),
        ],
      },
    });
    const share =
      shares.find(
        (item) => item.objectType === objectType && item.objectId === objectId,
      ) ??
      shares.find((item) => item.objectType === 'base') ??
      shares.find((item) => item.objectType === 'sheet');
    if (!share) return null;
    return {
      role: (share.role === 'edit' ? 'editor' : 'viewer') as WorkspaceRole,
      baseId: object.baseId ?? object.objectId ?? objectId,
      sourceWorkspaceId: object.sourceWorkspaceId,
      shareId: share.id,
    };
  }

  async assertAccess(
    objectType: 'base' | 'sheet',
    objectId: string,
    userId: string,
    minimum: WorkspaceRole,
  ): Promise<SharedAccess> {
    const access = await this.roleForObject(objectType, objectId, userId);
    if (!access) throw new ForbiddenException('无权访问该共享对象');
    if (!roleAtLeast(access.role, minimum)) {
      throw new ForbiddenException('权限不足');
    }
    return access;
  }

  async accessibleSheetIds(
    baseId: string,
    userId: string,
  ): Promise<string[] | null> {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) return [];
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: base.workspaceId, userId },
      },
    });
    if (membership) return null;
    const shares = await this.prisma.crossWorkspaceShare.findMany({
      where: {
        targetWorkspace: { members: { some: { userId } } },
        OR: [
          { objectType: 'base', objectId: baseId },
          {
            objectType: 'sheet',
            objectId: {
              in: (
                await this.prisma.sheet.findMany({
                  where: { baseId },
                  select: { id: true },
                })
              ).map((sheet) => sheet.id),
            },
          },
        ],
      },
    });
    if (shares.some((share) => share.objectType === 'base')) return null;
    return shares
      .filter((share) => share.objectType === 'sheet')
      .map((share) => share.objectId);
  }

  async sharedBases(targetWorkspaceId: string, userId: string) {
    await this.workspaces.requireMember(targetWorkspaceId, userId, 'viewer');
    const shares = await this.prisma.crossWorkspaceShare.findMany({
      where: { targetWorkspaceId },
      orderBy: { createdAt: 'asc' },
    });
    const baseIds = new Set<string>();
    for (const share of shares) {
      if (share.objectType === 'base') {
        baseIds.add(share.objectId);
      } else {
        const sheet = await this.prisma.sheet.findUnique({
          where: { id: share.objectId },
          select: { baseId: true },
        });
        if (sheet) baseIds.add(sheet.baseId);
      }
    }
    if (!baseIds.size) return [];
    return this.prisma.base.findMany({
      where: { id: { in: [...baseIds] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveObject(
    objectType: 'base' | 'sheet',
    objectId: string,
    sourceWorkspaceId?: string,
  ): Promise<{
    sourceWorkspaceId: string;
    baseId: string | null;
    objectId: string | null;
  } | null> {
    if (objectType === 'base') {
      const base = await this.prisma.base.findUnique({
        where: { id: objectId },
      });
      if (!base || (sourceWorkspaceId && base.workspaceId !== sourceWorkspaceId)) {
        return null;
      }
      return {
        sourceWorkspaceId: base.workspaceId,
        baseId: base.id,
        objectId: base.id,
      };
    }
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: objectId },
      include: { base: true },
    });
    if (!sheet || (sourceWorkspaceId && sheet.base.workspaceId !== sourceWorkspaceId)) {
      return null;
    }
    return {
      sourceWorkspaceId: sheet.base.workspaceId,
      baseId: sheet.baseId,
      objectId: sheet.id,
    };
  }
}
