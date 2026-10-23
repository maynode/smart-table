import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
    _sourceWorkspaceId: string,
    _userId: string,
    _body: {
      targetWorkspaceId: string;
      objectType: 'base' | 'sheet';
      objectId: string;
      role: 'view' | 'edit';
    },
  ) {
    throw new BadRequestException('跨工作区共享已停用');
  }

  async list(workspaceId: string, userId: string, _direction: 'in' | 'out') {
    await this.workspaces.requireMember(workspaceId, userId, 'viewer');
    return [];
  }

  async revoke(_shareId: string, _userId: string) {
    throw new BadRequestException('跨工作区共享已停用');
  }

  async roleForObject(
    _objectType: 'base' | 'sheet',
    _objectId: string,
    _userId: string,
  ): Promise<SharedAccess | null> {
    return null;
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
    return membership ? null : [];
  }

  async sharedBases(
    targetWorkspaceId: string,
    userId: string,
  ): Promise<Array<{ id: string }>> {
    await this.workspaces.requireMember(targetWorkspaceId, userId, 'viewer');
    return [];
  }
}
