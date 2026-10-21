import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    workspaceId?: string | null;
    actorId?: string | null;
    action: string;
    objectType: string;
    objectId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: input.workspaceId ?? null,
          actorId: input.actorId ?? null,
          action: input.action,
          objectType: input.objectType,
          objectId: input.objectId ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          ip: input.ip ?? '',
        },
      });
    } catch (error) {
      this.logger.warn(`audit write failed: ${String(error)}`);
    }
  }

  async recordSheet(
    sheetId: string,
    actorId: string,
    action: string,
    objectId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: { select: { workspaceId: true } } },
    });
    if (!sheet) return;
    await this.record({
      workspaceId: sheet.base.workspaceId,
      actorId,
      action,
      objectType: 'record',
      objectId,
      metadata: { ...metadata, sheetId, baseId: sheet.baseId },
    });
  }

  async list(
    workspaceId: string,
    userId: string,
    filter: {
      action?: string;
      objectType?: string;
      actorId?: string;
      limit?: string;
    },
  ) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('无权查看该工作区审计日志');
    }
    const limit = Math.min(Number(filter.limit ?? 100) || 100, 200);
    return this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.objectType ? { objectType: filter.objectType } : {}),
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
