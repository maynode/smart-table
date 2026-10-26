import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import {
  InvalidCronError,
  nextCronDate,
  type AutomationStep,
} from 'shared';
import { LiveBusService } from '../live/live-bus.service';
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

const TRIGGER_TYPES = [
  'recordCreated',
  'recordUpdated',
  'schedule',
  'recordTimer',
  'formSubmitted',
  'recordButton',
];
const STEP_TYPES = [
  'findRecords',
  'createRecord',
  'modifyRecords',
  'sendMessage',
  'sendHttp',
  'condition',
  'delay',
];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly runner: AutomationRunnerService,
    private readonly queue: AutomationQueueService,
    private readonly quotas: QuotasService,
    private readonly live: LiveBusService,
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
        nextRunAt: this.nextRunFor(dto.trigger),
      },
    });

    await this.live.emit({
      baseId: automation.baseId,
      actorId: userId,
      kind: 'automation.created',
      entityId: automation.id,
      meta: { name: automation.name },
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

    const trigger =
      dto.trigger ??
      (automation.trigger as unknown as Record<string, unknown>);
    const steps =
      dto.steps ??
      (automation.steps as unknown as Array<Record<string, unknown>>);
    await this.validateDefinition(
      automation.baseId,
      trigger,
      steps,
      automationId,
    );

    const nextEnabled = dto.enabled ?? automation.enabled;
    let nextRunAt: Date | null | undefined;
    if (dto.trigger !== undefined) {
      nextRunAt = this.nextRunFor(dto.trigger);
    } else if (dto.enabled === false) {
      nextRunAt = null;
    } else if (
      dto.enabled === true &&
      !automation.nextRunAt &&
      String(trigger?.type) === 'schedule'
    ) {
      nextRunAt = this.nextRunFor(trigger);
    }
    if (!nextEnabled) nextRunAt = null;

    const updated = await this.prisma.automation.update({
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
        ...(nextRunAt === undefined ? {} : { nextRunAt }),
      },
    });
    await this.live.emit({
      baseId: updated.baseId,
      actorId: userId,
      kind: 'automation.updated',
      entityId: updated.id,
      meta: { name: updated.name },
    });
    return updated;
  }

  async remove(userId: string, automationId: string) {
    const automation = await this.findAccessible(automationId, userId, 'editor');
    await this.prisma.automation.delete({ where: { id: automationId } });
    await this.live.emit({
      baseId: automation.baseId,
      actorId: userId,
      kind: 'automation.deleted',
      entityId: automationId,
    });
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

  async listSheetButtons(userId: string, sheetId: string) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    await this.workspacesService.requireMember(
      sheet.base.workspaceId,
      userId,
      'viewer',
    );
    return this.runner.listRecordButtons(sheetId);
  }

  async runSheetButton(
    userId: string,
    sheetId: string,
    recordId: string,
    buttonKey: string,
  ) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    await this.workspacesService.requireMember(
      sheet.base.workspaceId,
      userId,
      'editor',
    );
    await this.quotas.assertAutomationRun(sheet.base.workspaceId);
    return this.runner.triggerRecordButton(
      sheetId,
      recordId,
      buttonKey,
      userId,
    );
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
    excludeAutomationId?: string,
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
      try {
        nextCronDate(trigger.cron, {
          timezone:
            typeof trigger.timezone === 'string'
              ? trigger.timezone
              : undefined,
        });
      } catch (error) {
        if (error instanceof InvalidCronError) {
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException('cron 表达式或时区不合法');
      }
    } else if (triggerType === 'recordTimer') {
      await this.assertSheetInBase(baseId, String(trigger.sheetId ?? ''));
      if (typeof trigger.fieldId !== 'string' || !trigger.fieldId.trim()) {
        throw new BadRequestException('到达时间触发缺少日期字段');
      }
      const field = await this.prisma.field.findFirst({
        where: {
          id: trigger.fieldId,
          sheetId: String(trigger.sheetId),
        },
      });
      if (!field || field.type !== 'date') {
        throw new BadRequestException('到达时间触发必须选择日期字段');
      }
      if (trigger.filters) this.validateFilters(trigger.filters);
    } else if (triggerType === 'formSubmitted') {
      const formId = String(trigger.formId ?? '');
      if (!formId) throw new BadRequestException('表单提交触发缺少 formId');
      const form = await this.prisma.form.findFirst({
        where: { id: formId, baseId },
      });
      if (!form) throw new BadRequestException('表单不存在或不属于当前文档');
      if (trigger.filters) this.validateFilters(trigger.filters);
    } else if (triggerType === 'recordButton') {
      await this.assertSheetInBase(baseId, String(trigger.sheetId ?? ''));
      const buttonKey = String(trigger.buttonKey ?? '').trim();
      const buttonLabel = String(trigger.buttonLabel ?? '').trim();
      const sheetId = String(trigger.sheetId ?? '');
      if (!buttonKey) {
        throw new BadRequestException('按钮触发缺少 buttonKey');
      }
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(buttonKey)) {
        throw new BadRequestException(
          'buttonKey 仅允许字母数字、下划线与短横线',
        );
      }
      if (!buttonLabel) {
        throw new BadRequestException('按钮触发缺少 buttonLabel');
      }
      if (trigger.filters) this.validateFilters(trigger.filters);
      await this.assertButtonKeyUnique(
        baseId,
        sheetId,
        buttonKey,
        excludeAutomationId,
      );
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
        if (raw.channel !== 'doc') {
          throw new BadRequestException('消息渠道仅支持文档消息');
        }
        const content = raw.content as Record<string, unknown> | undefined;
        if (!content || typeof content.text !== 'string') {
          throw new BadRequestException('消息内容缺少文本');
        }
      }

      if (type === 'sendHttp') {
        const method = String(raw.method ?? 'GET').toUpperCase();
        if (!HTTP_METHODS.includes(method)) {
          throw new BadRequestException('HTTP 方法不合法');
        }
        if (typeof raw.url !== 'string' || !raw.url.trim()) {
          throw new BadRequestException('HTTP 请求缺少 URL');
        }
        if (raw.headers !== undefined) {
          if (
            !raw.headers ||
            typeof raw.headers !== 'object' ||
            Array.isArray(raw.headers)
          ) {
            throw new BadRequestException('HTTP 请求头格式不正确');
          }
        }
      }

      if (type === 'condition') {
        if (!raw.filters) {
          throw new BadRequestException('条件步骤缺少 filters');
        }
        this.validateFilters(raw.filters);
        const source = raw.source;
        if (
          source &&
          source !== 'trigger' &&
          (typeof source !== 'object' ||
            !knownStepIds.has(String((source as { stepId?: string }).stepId)))
        ) {
          throw new BadRequestException('条件步骤对照了不存在的步骤');
        }
      }

      if (type === 'delay') {
        const delayMs = Number(raw.delayMs);
        if (
          !Number.isFinite(delayMs) ||
          delayMs < MIN_DELAY_MS ||
          delayMs > MAX_DELAY_MS
        ) {
          throw new BadRequestException(
            `延迟需在 ${MIN_DELAY_MS / 1000} 秒～24 小时之间`,
          );
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

  private nextRunFor(trigger: Record<string, unknown>): Date | null {
    if (String(trigger?.type) !== 'schedule') return null;
    const cron = typeof trigger.cron === 'string' ? trigger.cron : '';
    if (!cron) return null;
    try {
      return nextCronDate(cron, {
        timezone:
          typeof trigger.timezone === 'string' ? trigger.timezone : undefined,
      });
    } catch {
      return null;
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

  /** 同表 buttonKey 全局唯一（启用/停用都算，避免列表碰撞）. */
  private async assertButtonKeyUnique(
    baseId: string,
    sheetId: string,
    buttonKey: string,
    excludeAutomationId?: string,
  ): Promise<void> {
    const automations = await this.prisma.automation.findMany({
      where: { baseId },
      select: { id: true, trigger: true },
    });
    for (const item of automations) {
      if (excludeAutomationId && item.id === excludeAutomationId) continue;
      const trigger = item.trigger as Record<string, unknown> | null;
      if (!trigger || trigger.type !== 'recordButton') continue;
      if (
        String(trigger.sheetId ?? '') === sheetId &&
        String(trigger.buttonKey ?? '').trim() === buttonKey
      ) {
        throw new BadRequestException(
          `按钮键「${buttonKey}」已在本表其他自动化中使用`,
        );
      }
    }
  }
}

export type { AutomationStep };
