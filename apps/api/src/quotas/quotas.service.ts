import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isInstallAdmin as checkInstallAdmin } from '../auth/install-admin';
import { PrismaService } from '../prisma/prisma.service';

export interface QuotaLimits {
  maxSeats: number;
  maxStorageBytes: number;
  maxAutomationRunsPerMonth: number;
}

export interface QuotaUsage {
  seats: number;
  storageBytes: number;
  automationRunsThisMonth: number;
}

@Injectable()
export class QuotasService {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string, userId: string) {
    await this.requireMember(workspaceId, userId);
    return this.snapshot(workspaceId, await this.isInstallAdmin(userId));
  }

  async adminOverview(userId: string) {
    const canEdit = await this.isInstallAdmin(userId);
    const installation = await this.resolvePolicy(null);
    return { canEdit, installation, defaults: this.defaults() };
  }

  async updatePolicy(
    userId: string,
    body: {
      scope: 'installation' | 'workspace';
      workspaceId?: string;
      maxSeats?: number;
      maxStorageBytes?: number;
      maxAutomationRunsPerMonth?: number;
    },
  ) {
    if (!(await this.isInstallAdmin(userId))) {
      throw new ForbiddenException({
        code: 'INSTALL_ADMIN_REQUIRED',
        message: '仅安装管理员可以修改配额策略',
      });
    }
    const limits = this.normalize(body);
    const key =
      body.scope === 'workspace'
        ? `workspace:${body.workspaceId ?? ''}`
        : 'installation';
    if (body.scope === 'workspace') {
      if (!body.workspaceId) throw new BadRequestException('缺少 workspaceId');
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: body.workspaceId },
      });
      if (!workspace) throw new NotFoundException('工作区不存在');
    }
    const policy = await this.prisma.quotaPolicy.upsert({
      where: { key },
      create: {
        key,
        workspaceId: body.scope === 'workspace' ? body.workspaceId : null,
        ...limits,
      },
      update: limits,
    });
    return this.presentPolicy(policy);
  }

  async assertSeats(workspaceId: string): Promise<void> {
    const [limits, usage] = await Promise.all([
      this.resolvePolicy(workspaceId),
      this.usage(workspaceId),
    ]);
    if (usage.seats >= limits.maxSeats) {
      throw new ForbiddenException({
        code: 'QUOTA_SEATS_EXCEEDED',
        message: `席位配额已用尽（${usage.seats}/${limits.maxSeats}）`,
      });
    }
  }

  /** 自动化运行次数不限额（仅统计用量，不拦截）. */
  async assertAutomationRun(_workspaceId: string): Promise<void> {
    return;
  }

  async assertStorage(workspaceId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const [limits, usage] = await Promise.all([
      this.resolvePolicy(workspaceId),
      this.usage(workspaceId),
    ]);
    if (usage.storageBytes + bytes > limits.maxStorageBytes) {
      throw new ForbiddenException({
        code: 'QUOTA_STORAGE_EXCEEDED',
        message: `存储配额不足（已用 ${usage.storageBytes} / ${limits.maxStorageBytes} 字节）`,
      });
    }
  }

  async recordStorage(
    workspaceId: string,
    key: string,
    bytes: number,
  ): Promise<void> {
    await this.prisma.storageObject.create({
      data: { workspaceId, key, sizeBytes: BigInt(Math.max(0, bytes)) },
    });
  }

  private async snapshot(workspaceId: string, canEdit: boolean) {
    const [limits, usage] = await Promise.all([
      this.resolvePolicy(workspaceId),
      this.usage(workspaceId),
    ]);
    return {
      workspaceId,
      canEdit,
      limits,
      usage,
      exceeded: {
        seats: usage.seats >= limits.maxSeats,
        storage: usage.storageBytes >= limits.maxStorageBytes,
        automationRuns: false,
      },
    };
  }

  private async resolvePolicy(
    workspaceId: string | null,
  ): Promise<QuotaLimits> {
    const defaults = this.defaults();
    const installation = await this.prisma.quotaPolicy.findUnique({
      where: { key: 'installation' },
    });
    const workspace = workspaceId
      ? await this.prisma.quotaPolicy.findUnique({
          where: { workspaceId },
        })
      : null;
    const selected = workspace ?? installation;
    return selected
      ? {
          maxSeats: selected.maxSeats,
          maxStorageBytes: Number(selected.maxStorageBytes),
          maxAutomationRunsPerMonth: selected.maxAutomationRunsPerMonth,
        }
      : defaults;
  }

  private async usage(workspaceId: string): Promise<QuotaUsage> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [memberSeats, inviteSeats, storage, runs] = await Promise.all([
      this.prisma.workspaceMember.count({ where: { workspaceId } }),
      this.prisma.workspaceInvite.count({ where: { workspaceId } }),
      this.prisma.storageObject.aggregate({
        where: { workspaceId },
        _sum: { sizeBytes: true },
      }),
      this.prisma.automationRun.count({
        where: {
          startedAt: { gte: monthStart },
          automation: { base: { workspaceId } },
        },
      }),
    ]);
    return {
      seats: memberSeats + inviteSeats,
      storageBytes: Number(storage._sum.sizeBytes ?? 0n),
      automationRunsThisMonth: runs,
    };
  }

  private defaults(): QuotaLimits {
    return {
      maxSeats: Number(process.env.QUOTA_MAX_SEATS ?? 50),
      maxStorageBytes: Number(
        process.env.QUOTA_MAX_STORAGE_BYTES ?? 10 * 1024 * 1024 * 1024,
      ),
      maxAutomationRunsPerMonth: Number(
        process.env.QUOTA_MAX_AUTOMATION_RUNS_PER_MONTH ?? 10000,
      ),
    };
  }

  private normalize(body: {
    maxSeats?: number;
    maxStorageBytes?: number;
    maxAutomationRunsPerMonth?: number;
  }): QuotaLimits {
    const defaults = this.defaults();
    const limits = {
      maxSeats: body.maxSeats ?? defaults.maxSeats,
      maxStorageBytes: body.maxStorageBytes ?? defaults.maxStorageBytes,
      maxAutomationRunsPerMonth:
        body.maxAutomationRunsPerMonth ?? defaults.maxAutomationRunsPerMonth,
    };
    if (!Number.isInteger(limits.maxSeats) || limits.maxSeats < 1) {
      throw new BadRequestException('maxSeats 必须为正整数');
    }
    if (
      !Number.isInteger(limits.maxAutomationRunsPerMonth) ||
      limits.maxAutomationRunsPerMonth < 1
    ) {
      throw new BadRequestException('maxAutomationRunsPerMonth 必须为正整数');
    }
    if (!Number.isFinite(limits.maxStorageBytes) || limits.maxStorageBytes < 1) {
      throw new BadRequestException('maxStorageBytes 必须为正数');
    }
    return limits;
  }

  private async requireMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw new ForbiddenException('无权查看该工作区配额');
    return member;
  }

  private isInstallAdmin(userId: string): Promise<boolean> {
    return checkInstallAdmin(this.prisma, userId);
  }

  private presentPolicy(policy: {
    key: string;
    workspaceId: string | null;
    maxSeats: number;
    maxStorageBytes: bigint;
    maxAutomationRunsPerMonth: number;
    updatedAt: Date;
  }) {
    return {
      key: policy.key,
      workspaceId: policy.workspaceId,
      maxSeats: policy.maxSeats,
      maxStorageBytes: Number(policy.maxStorageBytes),
      maxAutomationRunsPerMonth: policy.maxAutomationRunsPerMonth,
      updatedAt: policy.updatedAt,
    };
  }
}
