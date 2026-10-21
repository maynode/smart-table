import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import type { AutomationStep } from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AutomationQueueService } from './automation-queue.service';
import {
  AutomationRunnerService,
  type AutomationRunContext,
} from './automation-runner.service';
import type {
  CreateAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';

const TRIGGER_TYPES = ['recordCreated', 'recordUpdated', 'schedule'];
const STEP_TYPES = [
  'findRecords',
  'createRecord',
  'modifyRecords',
  'sendMessage',
  'startGroupChat',
  'addGroupMembers',
];

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly runner: AutomationRunnerService,
    private readonly queue: AutomationQueueService,
    private readonly quotas: QuotasService,
  ) {}

  async create(userId: string, dto: CreateAutomationDto) {
    await this.requireBase(dto.baseId, userId, 'editor');
    await this.validateDefinition(dto.baseId, dto.trigger, dto.steps);

    const automation = await this.prisma.automation.create({
      data: {
        baseId: dto.baseId,
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        trigger: dto.trigger as Prisma.InputJsonValue,
        steps: dto.steps as unknown as Prisma.InputJsonValue,
        onFindEmpty: dto.onFindEmpty ?? 'continue',
        monthlyQuota: dto.monthlyQuota ?? null,
      },
    });

    return { ...automation, monthlyRunCount: 0 };
  }

  async list(userId: string, baseId: string) {
    await this.requireBase(baseId, userId, 'viewer');
    const automations = await this.prisma.automation.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const counts = await this.prisma.automationRun.groupBy({
      by: ['automationId'],
      where: {
        automationId: { in: automations.map((automation) => automation.id) },
        startedAt: { gte: startOfMonth },
        status: 'success',
      },
      _count: { _all: true },
    });
    const countByAutomation = new Map(
      counts.map((row) => [row.automationId, row._count._all]),
    );

    return automations.map((automation) => ({
      ...automation,
      monthlyRunCount: countByAutomation.get(automation.id) ?? 0,
    }));
  }

  async get(userId: string, automationId: string) {
    const automation = await this.findAccessible(automationId, userId, 'viewer');
    const runs = await this.prisma.automationRun.count({
      where: { automationId },
    });
    return { ...automation, totalRuns: runs };
  }

  async update(
    userId: string,
    automationId: string,
    dto: UpdateAutomationDto,
  ) {
    const automation = await this.findAccessible(
      automationId,
      userId,
      'editor',
    );

    const trigger = dto.trigger ?? (automation.trigger as unknown as object);
    const steps =
      dto.steps ??
      (automation.steps as unknown as Array<Record<string, unknown>>);
    await this.validateDefinition(
      automation.baseId,
      trigger as Record<string, unknown>,
      steps,
    );

    return this.prisma.automation.update({
      where: { id: automationId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
        ...(dto.trigger === undefined
          ? {}
          : { trigger: dto.trigger as Prisma.InputJsonValue }),
        ...(dto.steps === undefined
          ? {}
          : {
              steps: dto.steps as unknown as Prisma.InputJsonValue,
            }),
        ...(dto.onFindEmpty === undefined
          ? {}
          : { onFindEmpty: dto.onFindEmpty }),
        ...(dto.monthlyQuota === undefined
          ? {}
          : { monthlyQuota: dto.monthlyQuota }),
      },
    });
  }

  async remove(userId: string, automationId: string) {
    await this.findAccessible(automationId, userId, 'editor');
    await this.prisma.automation.delete({ where: { id: automationId } });
    return { deleted: true };
  }

  async listRuns(userId: string, automationId: string, limit = 50) {
    await this.findAccessible(automationId, userId, 'viewer');
    const runs = await this.prisma.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { steps: { orderBy: { stepIndex: 'asc' } } },
    });

    return runs.map((run) => ({
      id: run.id,
      automationId: run.automationId,
      status: run.status,
      error: run.error,
      triggerRecordId: run.triggerRecordId,
      outputs: run.outputs,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      steps: run.steps.map((step) => ({
        stepIndex: step.stepIndex,
        type: step.type,
        status: step.status,
        error: step.error,
        durationMs: step.durationMs,
        output: step.output,
      })),
    }));
  }

  async runManually(
    userId: string,
    automationId: string,
    context: AutomationRunContext,
  ) {
    await this.findAccessible(automationId, userId, 'editor');
    const automation = await this.prisma.automation.findUniqueOrThrow({
      where: { id: automationId },
      include: { base: true },
    });
    await this.quotas.assertAutomationRun(automation.base.workspaceId);
    if (!this.queue.isQueueEnabled()) {
      return this.runner.runAutomation(automationId, context);
    }
    return this.queue.enqueue(automationId, context);
  }

  private async findAccessible(
    automationId: string,
    userId: string,
    minimum: WorkspaceRole,
  ) {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: { base: true },
    });
    if (!automation) {
      throw new NotFoundException('自动化不存在');
    }
    await this.workspacesService.requireMember(
      automation.base.workspaceId,
      userId,
      minimum,
    );
    return automation;
  }

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

  private async validateDefinition(
    baseId: string,
    trigger: Record<string, unknown> | undefined,
    steps: Array<Record<string, unknown>> | undefined,
  ): Promise<void> {
    if (!trigger || typeof trigger !== 'object') {
      throw new BadRequestException('缺少触发器配置');
    }
    const triggerType = String(trigger.type);
    if (!TRIGGER_TYPES.includes(triggerType)) {
      throw new BadRequestException(`未知触发器类型: ${triggerType}`);
    }

    if (triggerType === 'schedule') {
      if (typeof trigger.cron !== 'string' || !trigger.cron.trim()) {
        throw new BadRequestException('定时触发器缺少 cron 表达式');
      }
    } else {
      await this.assertSheetInBase(baseId, String(trigger.sheetId ?? ''));
      if (trigger.filters) this.validateFilters(trigger.filters);
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('自动化至少需要一个步骤');
    }

    const knownStepIds = new Set<string>();
    for (const raw of steps) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('步骤格式不正确');
      }
      const stepId = String(raw.id ?? '');
      const type = String(raw.type);
      if (!stepId) throw new BadRequestException('步骤缺少 id');
      if (knownStepIds.has(stepId)) {
        throw new BadRequestException('步骤 id 重复');
      }
      if (!STEP_TYPES.includes(type)) {
        throw new BadRequestException(`未知步骤类型: ${type}`);
      }

      if (type === 'findRecords' || type === 'createRecord') {
        await this.assertSheetInBase(baseId, String(raw.sheetId ?? ''));
        if (type === 'findRecords' && raw.filters) {
          this.validateFilters(raw.filters);
        }
        if (type === 'createRecord') this.assertCellMapping(raw.cells);
      }

      if (type === 'modifyRecords') {
        const target = raw.target as Record<string, unknown> | undefined;
        if (
          !target ||
          !['fromStep', 'ids', 'filters'].includes(String(target.mode))
        ) {
          throw new BadRequestException('修改记录步骤缺少目标');
        }
        if (target.mode === 'fromStep' && !knownStepIds.has(String(target.stepId))) {
          throw new BadRequestException('修改目标引用了不存在的步骤');
        }
        if (target.mode === 'ids' && !Array.isArray(target.recordIds)) {
          throw new BadRequestException('修改目标缺少记录 id');
        }
        if (target.mode === 'filters') {
          await this.assertSheetInBase(baseId, String(target.sheetId ?? ''));
          if (target.filters) this.validateFilters(target.filters);
        }
        this.assertCellMapping(raw.cells);
      }

      if (type === 'sendMessage') {
        if (raw.channel !== 'doc' && raw.channel !== 'group') {
          throw new BadRequestException('消息渠道必须是 doc 或 group');
        }
        const content = raw.content as Record<string, unknown> | undefined;
        if (!content || typeof content.text !== 'string') {
          throw new BadRequestException('消息内容缺少文本');
        }
      }

      if (type === 'startGroupChat') {
        if (typeof raw.name !== 'string' || !raw.name.trim()) {
          throw new BadRequestException('群聊名称不能为空');
        }
      }

      knownStepIds.add(stepId);
    }
  }

  private assertCellMapping(cells: unknown): void {
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
      throw new BadRequestException('字段映射格式不正确');
    }
    for (const value of Object.values(cells as Record<string, unknown>)) {
      if (
        !value ||
        typeof value !== 'object' ||
        !['literal', 'variable'].includes(String((value as { kind?: string }).kind))
      ) {
        throw new BadRequestException('字段映射值格式不正确');
      }
    }
  }

  private validateFilters(filters: unknown): void {
    if (!filters || typeof filters !== 'object') {
      throw new BadRequestException('筛选条件格式不正确');
    }
    const group = filters as {
      conjunction?: string;
      conditions?: unknown[];
    };
    if (
      !Array.isArray(group.conditions) ||
      !['and', 'or'].includes(String(group.conjunction))
    ) {
      throw new BadRequestException('筛选条件格式不正确');
    }
    for (const node of group.conditions) {
      if (!node || typeof node !== 'object') {
        throw new BadRequestException('筛选条件格式不正确');
      }
      if (Array.isArray((node as { conditions?: unknown[] }).conditions)) {
        this.validateFilters(node);
        continue;
      }
      const condition = node as { fieldId?: string; operator?: string };
      if (!condition.fieldId || !condition.operator) {
        throw new BadRequestException('筛选条件缺少字段或运算符');
      }
    }
  }

  private async assertSheetInBase(
    baseId: string,
    sheetId: string,
  ): Promise<void> {
    if (!sheetId) {
      throw new BadRequestException('缺少工作表 id');
    }
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
    });
    if (!sheet || sheet.baseId !== baseId) {
      throw new BadRequestException('工作表不属于该 Base');
    }
  }
}

export type { AutomationStep };
