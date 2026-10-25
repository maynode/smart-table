import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkspaceRole,
  type Automation,
  type Field,
  type RecordRow,
} from '@prisma/client';
import {
  evaluateFilterGroup,
  resolveFindLimit,
  resolveOnEmpty,
  type AutomationDefinition,
  type AutomationRunResult,
  type AutomationRunStatus,
  type AutomationStep,
  type AutomationTrigger,
  type CellMapping,
  type ConditionStep,
  type DelayStep,
  type FilterGroup,
  type FindEmptyBehavior,
  type FindRecordsStep,
  type FormSubmittedTrigger,
  type ModifyRecordsStep,
  type RecordButtonTrigger,
  type StepOutput,
  type StepValueExpression,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFilterSql,
  buildSortSql,
} from './automation-filter.sql';
import { AutomationQueueService } from './automation-queue.service';
import {
  NOTIFY_ADAPTER,
  type NotifyAdapter,
} from './notify.adapter';

export interface AutomationRunContext {
  triggerRecordId?: string;
  triggerCells?: Record<string, unknown>;
  /** Submitter of a public form, used for 填写者 recipients. */
  submitterUserId?: string;
  idempotencyKey?: string;
  /** 续跑：从该下标开始执行（延迟步骤用）. */
  startStepIndex?: number;
  /** 续跑时带入已产出的扁平变量. */
  priorFlatValues?: Record<string, string>;
  /** 续跑时带入前序步骤输出（JSON 可序列化）. */
  priorStepOutputs?: StepOutput[];
  /** BullMQ/调度器续跑时指向 waiting 的同一 run. */
  resumeRunId?: string;
  /** 进入 delay 时快照的步骤，续跑不受中途改定义影响. */
  stepsSnapshot?: AutomationStep[];
}

type InternalStepOutput = StepOutput;

interface ExecutionState {
  automation: AutomationDefinition;
  triggerRecordId?: string;
  triggerCells: Record<string, unknown>;
  triggerByName: Map<string, unknown>;
  triggerUser?: string;
  stepOutputs: Map<string, InternalStepOutput>;
  flatValues: Record<string, string>;
}

interface StepExecution {
  output: InternalStepOutput;
  stop?: boolean;
  /** 条件不成立：跳过后续但仍 success. */
  skipRest?: boolean;
  /** 延迟后续步骤（毫秒）. */
  delayMs?: number;
}

type ExecuteResult = Omit<AutomationRunResult, 'pendingDelay'> & {
  pendingDelay?: { delayMs: number; resumeContext: AutomationRunContext };
};

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFY_ADAPTER) private readonly notify: NotifyAdapter,
    @Inject(forwardRef(() => AutomationQueueService))
    private readonly queue: AutomationQueueService,
  ) {}

  async runAutomation(
    automationId: string,
    context: AutomationRunContext = {},
    outerTx?: Prisma.TransactionClient,
  ): Promise<AutomationRunResult> {
    if (context.resumeRunId) {
      return this.resumeWaitingRun(context.resumeRunId, automationId, context);
    }

    if (outerTx) {
      return this.toPublicResult(
        await this.execute(automationId, context, outerTx),
        automationId,
      );
    }

    try {
      const result = await this.prisma.$transaction(
        (tx) => this.execute(automationId, context, tx),
        { timeout: 30_000 },
      );
      await this.maybeEnqueueDelay(result, automationId);
      return this.toPublicResult(result, automationId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        context.idempotencyKey
      ) {
        const existing = await this.prisma.automationRun.findUnique({
          where: {
            automationId_idempotencyKey: {
              automationId,
              idempotencyKey: context.idempotencyKey,
            },
          },
        });
        if (existing) return this.resultFromRun(existing);
      }
      throw error;
    }
  }

  /**
   * 认领 waiting run 并续跑（认领与执行同一事务：崩溃回滚仍为 waiting）.
   * 与 DB 轮询 / BullMQ 共用，避免再开新 run.
   */
  private async resumeWaitingRun(
    runId: string,
    automationId: string,
    context: AutomationRunContext,
  ): Promise<AutomationRunResult> {
    const { resumeRunId: _omit, ...resumeContext } = context;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$executeRaw(Prisma.sql`
          UPDATE automation_runs
          SET status = 'running', resume_at = NULL
          WHERE id = ${runId}::uuid
            AND automation_id = ${automationId}::uuid
            AND status = 'waiting'
        `);
        if (Number(claimed) === 0) return null;
        return this.execute(automationId, resumeContext, tx, {
          existingRunId: runId,
        });
      },
      { timeout: 30_000 },
    );

    if (!result) {
      const existing = await this.prisma.automationRun.findUnique({
        where: { id: runId },
      });
      if (existing) return this.resultFromRun(existing);
      throw new NotFoundException('待续跑的自动化运行不存在');
    }

    await this.maybeEnqueueDelay(result, automationId);
    return this.toPublicResult(result, automationId);
  }

  private async maybeEnqueueDelay(
    result: ExecuteResult,
    automationId: string,
  ): Promise<void> {
    if (!result.pendingDelay || !this.queue.isQueueEnabled()) return;
    await this.queue
      .enqueueDelayed(
        automationId,
        {
          ...result.pendingDelay.resumeContext,
          resumeRunId: result.runId,
        },
        result.pendingDelay.delayMs,
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `bullmq delay enqueue failed, DB poll will pick up: ${String(error)}`,
        ),
      );
  }

  /**
   * 事务提交后调用：有 BullMQ 时加速续跑；否则仅靠 scheduler 扫 resume_at.
   */
  async schedulePendingDelay(pending: {
    delayMs: number;
    automationId: string;
    resumeContext: Record<string, unknown>;
    runId?: string;
  }): Promise<void> {
    if (!this.queue.isQueueEnabled()) return;
    const resumeRunId =
      pending.runId ??
      (typeof pending.resumeContext.resumeRunId === 'string'
        ? pending.resumeContext.resumeRunId
        : undefined);
    await this.queue
      .enqueueDelayed(
        pending.automationId,
        {
          ...(pending.resumeContext as AutomationRunContext),
          ...(resumeRunId ? { resumeRunId } : {}),
        },
        pending.delayMs,
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `schedulePendingDelay enqueue failed, DB poll will pick up: ${String(error)}`,
        ),
      );
  }

  /** 轮询到期的 waiting 运行并续跑（耐久，不依赖进程内 setTimeout）. */
  async runDueDelayedRuns(limit = 20): Promise<
    Array<{ runId: string; automationId: string; status: string }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        automation_id: string;
        resume_context: unknown;
      }>
    >(Prisma.sql`
      SELECT id, automation_id, resume_context
      FROM automation_runs
      WHERE status = 'waiting'
        AND resume_at IS NOT NULL
        AND resume_at <= NOW()
      ORDER BY resume_at ASC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `);

    const results: Array<{
      runId: string;
      automationId: string;
      status: string;
    }> = [];

    for (const row of rows) {
      const ctx = {
        ...((row.resume_context ?? {}) as AutomationRunContext),
        resumeRunId: row.id,
      };
      try {
        const result = await this.resumeWaitingRun(
          row.id,
          row.automation_id,
          ctx,
        );
        results.push({
          runId: result.runId,
          automationId: row.automation_id,
          status: result.status,
        });
      } catch (error) {
        results.push({
          runId: row.id,
          automationId: row.automation_id,
          status: 'failed',
        });
        this.logger.error(
          `delay resume ${row.id} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return results;
  }

  private toPublicResult(
    result: ExecuteResult,
    automationId: string,
  ): AutomationRunResult {
    return {
      runId: result.runId,
      status: result.status,
      stepOutputs: result.stepOutputs,
      outputs: result.outputs,
      ...(result.error ? { error: result.error } : {}),
      ...(result.pendingDelay
        ? {
            pendingDelay: {
              delayMs: result.pendingDelay.delayMs,
              automationId,
              runId: result.runId,
              resumeContext: result.pendingDelay
                .resumeContext as unknown as Record<string, unknown>,
            },
          }
        : {}),
    };
  }

  /** Runs every enabled automation whose recordCreated trigger matches. */
  async triggerRecordCreated(
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
    submitterUserId?: string,
  ): Promise<AutomationRunResult[]> {
    return this.triggerRecord(
      'recordCreated',
      recordId,
      outerTx,
      idempotencyKey,
      submitterUserId,
    );
  }

  async triggerRecordUpdated(
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
    submitterUserId?: string,
  ): Promise<AutomationRunResult[]> {
    return this.triggerRecord(
      'recordUpdated',
      recordId,
      outerTx,
      idempotencyKey,
      submitterUserId,
    );
  }

  /** 收集表单提交成功后触发 formSubmitted 自动化. */
  async triggerFormSubmitted(
    formId: string,
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
    submitterUserId?: string,
  ): Promise<AutomationRunResult[]> {
    const db = outerTx ?? this.prisma;
    const record = await db.recordRow.findUnique({
      where: { id: recordId },
      include: { sheet: { select: { baseId: true } } },
    });
    if (!record) return [];

    const fields = await db.field.findMany({
      where: { sheetId: record.sheetId },
    });
    const cells = (record.cells ?? {}) as Record<string, unknown>;
    const automations = await db.automation.findMany({
      where: { enabled: true, baseId: record.sheet.baseId },
    });

    const results: AutomationRunResult[] = [];
    for (const automation of automations) {
      const trigger = automation.trigger as unknown as AutomationTrigger;
      if (trigger.type !== 'formSubmitted') continue;
      const formTrigger = trigger as FormSubmittedTrigger;
      if (formTrigger.formId !== formId) continue;
      if (formTrigger.filters) {
        const normalized = this.normalizeFilterFieldIds(
          formTrigger.filters,
          fields,
        );
        if (!evaluateFilterGroup(normalized, cells)) continue;
      }
      results.push(
        await this.runAutomation(
          automation.id,
          {
            triggerRecordId: record.id,
            submitterUserId,
            idempotencyKey:
              idempotencyKey ?? `formSubmitted:${formId}:${record.id}`,
          },
          outerTx,
        ),
      );
    }
    return results;
  }

  /** 表格行自定义按钮触发. */
  async triggerRecordButton(
    sheetId: string,
    recordId: string,
    buttonKey: string,
    userId?: string,
  ): Promise<AutomationRunResult[]> {
    const record = await this.prisma.recordRow.findUnique({
      where: { id: recordId },
      include: { sheet: { select: { baseId: true, id: true } } },
    });
    if (!record || record.sheetId !== sheetId) return [];

    const fields = await this.prisma.field.findMany({
      where: { sheetId },
    });
    const cells = (record.cells ?? {}) as Record<string, unknown>;
    const automations = await this.prisma.automation.findMany({
      where: { enabled: true, baseId: record.sheet.baseId },
    });

    const results: AutomationRunResult[] = [];
    for (const automation of automations) {
      const trigger = automation.trigger as unknown as AutomationTrigger;
      if (trigger.type !== 'recordButton') continue;
      const btn = trigger as RecordButtonTrigger;
      if (btn.sheetId !== sheetId || btn.buttonKey !== buttonKey) continue;
      if (btn.filters) {
        const normalized = this.normalizeFilterFieldIds(btn.filters, fields);
        if (!evaluateFilterGroup(normalized, cells)) continue;
      }
      // 固定 inflight 键 + 唯一约束：并发点击合并到同一次；终态会清键以便重跑
      results.push(
        await this.runAutomation(automation.id, {
          triggerRecordId: record.id,
          submitterUserId: userId,
          idempotencyKey: `recordButton:${automation.id}:${buttonKey}:${record.id}:inflight`,
        }),
      );
    }
    return results;
  }

  /** 列出某表上可用的自动化按钮（启用且类型为 recordButton）. */
  async listRecordButtons(
    sheetId: string,
  ): Promise<Array<{ buttonKey: string; buttonLabel: string; automationId: string }>> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      select: { baseId: true },
    });
    if (!sheet) return [];
    const automations = await this.prisma.automation.findMany({
      where: { enabled: true, baseId: sheet.baseId },
    });
    const buttons: Array<{
      buttonKey: string;
      buttonLabel: string;
      automationId: string;
    }> = [];
    for (const automation of automations) {
      const trigger = automation.trigger as unknown as AutomationTrigger;
      if (trigger.type !== 'recordButton') continue;
      const btn = trigger as RecordButtonTrigger;
      if (btn.sheetId !== sheetId) continue;
      buttons.push({
        buttonKey: btn.buttonKey,
        buttonLabel: btn.buttonLabel || btn.buttonKey,
        automationId: automation.id,
      });
    }
    return buttons;
  }

  private async triggerRecord(
    type: 'recordCreated' | 'recordUpdated',
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
    submitterUserId?: string,
  ): Promise<AutomationRunResult[]> {
    const db = outerTx ?? this.prisma;
    const record = await db.recordRow.findUnique({
      where: { id: recordId },
      include: { sheet: { select: { baseId: true } } },
    });
    if (!record) return [];

    const fields = await db.field.findMany({
      where: { sheetId: record.sheetId },
    });
    const cells = (record.cells ?? {}) as Record<string, unknown>;
    // Scope to the base that owns this sheet — avoid scanning every
    // workspace automation on each form submit (WeCom pad-scoped list).
    const automations = await db.automation.findMany({
      where: { enabled: true, baseId: record.sheet.baseId },
    });

    const results: AutomationRunResult[] = [];
    for (const automation of automations) {
      const trigger = automation.trigger as unknown as AutomationTrigger;
      if (trigger.type !== type || trigger.sheetId !== record.sheetId) {
        continue;
      }
      if (trigger.filters) {
        const normalized = this.normalizeFilterFieldIds(
          trigger.filters,
          fields,
        );
        if (!evaluateFilterGroup(normalized, cells)) continue;
      }
      results.push(
        await this.runAutomation(
          automation.id,
          {
            triggerRecordId: record.id,
            submitterUserId,
            idempotencyKey: idempotencyKey ?? `${type}:${record.id}`,
          },
          outerTx,
        ),
      );
    }
    return results;
  }

  private normalizeFilterFieldIds(
    group: FilterGroup,
    fields: Field[],
  ): FilterGroup {
    return {
      conjunction: group.conjunction,
      conditions: group.conditions.map((node) => {
        if (Array.isArray((node as FilterGroup).conditions)) {
          return this.normalizeFilterFieldIds(node as FilterGroup, fields);
        }
        const condition = node as { fieldId: string; operator: string; value?: unknown };
        const match = fields.find(
          (field) =>
            field.id === condition.fieldId || field.name === condition.fieldId,
        );
        return {
          ...(condition as unknown as FilterGroup['conditions'][number]),
          fieldId: match?.id ?? condition.fieldId,
        } as FilterGroup['conditions'][number];
      }),
    };
  }

  private async execute(
    automationId: string,
    context: AutomationRunContext,
    tx: Prisma.TransactionClient,
    options?: { existingRunId?: string },
  ): Promise<ExecuteResult> {
    const automation = await tx.automation.findUnique({
      where: { id: automationId },
    });
    if (!automation) {
      throw new NotFoundException('自动化不存在');
    }

    const baseDefinition = this.toDefinition(automation);
    const definition: AutomationDefinition = {
      ...baseDefinition,
      ...(context.stepsSnapshot
        ? { steps: context.stepsSnapshot }
        : {}),
    };

    if (context.idempotencyKey && !options?.existingRunId) {
      const existing = await tx.automationRun.findUnique({
        where: {
          automationId_idempotencyKey: {
            automationId,
            idempotencyKey: context.idempotencyKey,
          },
        },
      });
      if (
        existing &&
        (existing.status === 'success' ||
          existing.status === 'running' ||
          existing.status === 'waiting' ||
          existing.status === 'skipped')
      ) {
        return this.resultFromRun(existing);
      }
    }

    const startedAt = new Date();
    let runId: string;
    if (options?.existingRunId) {
      runId = options.existingRunId;
      await tx.automationRun.update({
        where: { id: runId },
        data: { status: 'running', error: null },
      });
    } else {
      const run = await tx.automationRun.create({
        data: {
          automationId,
          status: definition.enabled ? 'running' : 'skipped',
          idempotencyKey: context.idempotencyKey ?? null,
          triggerRecordId: context.triggerRecordId ?? null,
          startedAt,
          ...(definition.enabled
            ? {}
            : { finishedAt: startedAt, durationMs: 0 }),
        },
      });
      runId = run.id;
    }

    if (!definition.enabled) {
      // 续跑遇到已停用：必须落库 skipped，避免卡在 running
      if (options?.existingRunId) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE automation_runs
          SET status = 'skipped',
              error = NULL,
              finished_at = NOW(),
              duration_ms = ${Date.now() - startedAt.getTime()},
              resume_at = NULL,
              resume_context = NULL,
              idempotency_key = CASE
                WHEN idempotency_key LIKE '%:inflight' THEN NULL
                ELSE idempotency_key
              END
          WHERE id = ${runId}::uuid
        `);
      }
      return {
        runId,
        status: 'skipped',
        stepOutputs: {},
        outputs: [],
      };
    }

    const state = await this.buildState(definition, context, tx);
    const outputs: InternalStepOutput[] = [
      ...(context.priorStepOutputs ?? []),
    ];
    for (const prior of context.priorStepOutputs ?? []) {
      state.stepOutputs.set(prior.stepId, prior);
    }
    let status: AutomationRunStatus = 'success';
    let errorMessage: string | undefined;
    let pendingDelay: ExecuteResult['pendingDelay'];
    const startIndex = Math.max(0, context.startStepIndex ?? 0);

    for (let index = startIndex; index < definition.steps.length; index += 1) {
      const step = definition.steps[index]!;
      const stepStarted = Date.now();
      let stepExecution: StepExecution;

      try {
        stepExecution = await this.executeStep(step, state, tx);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        stepExecution = {
          output: {
            stepId: step.id,
            type: step.type,
            error: errorMessage,
          },
        };
        status = 'failed';
      }

      const output = stepExecution.output;
      outputs.push(output);
      state.stepOutputs.set(step.id, output);
      if (output.values) Object.assign(state.flatValues, output.values);

      await tx.automationRunStep.create({
        data: {
          runId,
          stepIndex: index,
          type: step.type,
          status: output.error ? 'failed' : 'success',
          output: output as unknown as Prisma.InputJsonValue,
          error: output.error ?? null,
          durationMs: Date.now() - stepStarted,
        },
      });

      if (status === 'failed') break;
      if (stepExecution.stop) {
        status = 'skipped';
        break;
      }
      if (stepExecution.skipRest) {
        break;
      }
      if (stepExecution.delayMs && stepExecution.delayMs > 0) {
        const resumeIndex = index + 1;
        if (resumeIndex < definition.steps.length) {
          const resumeContext: AutomationRunContext = {
            triggerRecordId: context.triggerRecordId,
            triggerCells: context.triggerCells,
            submitterUserId: context.submitterUserId,
            startStepIndex: resumeIndex,
            priorFlatValues: { ...state.flatValues },
            priorStepOutputs: outputs.map((item) => ({ ...item })),
            stepsSnapshot: definition.steps,
            // 保持原幂等键，waiting 期间并发触发可合并到同一 run
            idempotencyKey: context.idempotencyKey,
          };
          pendingDelay = {
            delayMs: stepExecution.delayMs,
            resumeContext,
          };
          const resumeAt = new Date(Date.now() + stepExecution.delayMs);
          const durationMs = Date.now() - startedAt.getTime();
          await tx.$executeRaw(Prisma.sql`
            UPDATE automation_runs
            SET status = 'waiting',
                resume_at = ${resumeAt},
                resume_context = ${JSON.stringify(resumeContext)}::jsonb,
                outputs = ${JSON.stringify(state.flatValues)}::jsonb,
                error = NULL,
                finished_at = NULL,
                duration_ms = ${durationMs}
            WHERE id = ${runId}::uuid
          `);
          return {
            runId,
            status: 'waiting',
            stepOutputs: state.flatValues,
            outputs,
            pendingDelay,
          };
        }
        break;
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    // failed / 按钮 inflight：清键以便重试；success/waiting/skipped 保留防重放
    await tx.$executeRaw(Prisma.sql`
      UPDATE automation_runs
      SET status = ${status},
          outputs = ${JSON.stringify(state.flatValues)}::jsonb,
          error = ${errorMessage ?? null},
          finished_at = NOW(),
          duration_ms = ${durationMs},
          resume_at = NULL,
          resume_context = NULL,
          idempotency_key = CASE
            WHEN ${status} = 'failed' THEN NULL
            WHEN idempotency_key LIKE '%:inflight' THEN NULL
            ELSE idempotency_key
          END
      WHERE id = ${runId}::uuid
    `);

    return {
      runId,
      status,
      stepOutputs: state.flatValues,
      outputs,
      ...(errorMessage ? { error: errorMessage } : {}),
    };
  }

  private async buildState(
    definition: AutomationDefinition,
    context: AutomationRunContext,
    tx: Prisma.TransactionClient,
  ): Promise<ExecutionState> {
    let triggerCells = context.triggerCells ?? {};
    const triggerByName = new Map<string, unknown>();

    if (context.triggerRecordId) {
      const record = await tx.recordRow.findUnique({
        where: { id: context.triggerRecordId },
      });
      if (record) {
        triggerCells = (record.cells ?? {}) as Record<string, unknown>;
        const fields = await tx.field.findMany({
          where: { sheetId: record.sheetId },
        });
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(triggerCells, field.id)) {
            triggerByName.set(field.name, triggerCells[field.id]);
          }
        }
      }
    }

    const flatValues: Record<string, string> = {
      今天: this.naturalTime('today'),
      明天: this.naturalTime('tomorrow'),
      昨天: this.naturalTime('yesterday'),
      操作时间: new Date().toISOString().replace('T', ' ').slice(0, 19),
      提交时间: new Date().toISOString().replace('T', ' ').slice(0, 19),
      ...(context.priorFlatValues ?? {}),
    };
    if (context.triggerRecordId) {
      flatValues['记录链接'] = `/records/${context.triggerRecordId}`;
    }
    if (context.submitterUserId) {
      flatValues['填写者'] = context.submitterUserId;
      flatValues['操作人'] = context.submitterUserId;
      const submitter = await tx.user.findUnique({
        where: { id: context.submitterUserId },
        select: { name: true },
      });
      if (submitter?.name) {
        flatValues['填写者'] = submitter.name;
        flatValues['操作人'] = submitter.name;
      }
    }
    for (const [name, value] of triggerByName.entries()) {
      if (value !== undefined && value !== null && value !== '') {
        flatValues[name] = String(value);
      }
    }

    return {
      automation: definition,
      triggerRecordId: context.triggerRecordId,
      triggerCells,
      triggerByName,
      triggerUser: context.submitterUserId,
      stepOutputs: new Map(),
      flatValues,
    };
  }

  private async executeStep(
    step: AutomationStep,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    switch (step.type) {
      case 'findRecords':
        return this.findRecords(step, state, tx);
      case 'createRecord':
        return this.createRecord(step, state, tx);
      case 'modifyRecords':
        return this.modifyRecords(step, state, tx);
      case 'sendMessage':
        return this.sendMessage(step, state, tx);
      case 'sendHttp':
        return this.sendHttp(step, state);
      case 'condition':
        return this.runCondition(step, state, tx);
      case 'delay':
        return this.runDelay(step);
      default:
        throw new Error(
          `未知自动化步骤: ${(step as { type: string }).type}`,
        );
    }
  }

  private async runCondition(
    step: ConditionStep,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    let cells = state.triggerCells;
    let sheetIdForFields: string | undefined;

    if (step.source && step.source !== 'trigger') {
      const prior = state.stepOutputs.get(step.source.stepId);
      const record = prior?.records?.[0];
      if (record?.id) {
        // 读库上的最新 cells，避免同 run 内 modify/create 后仍用步骤快照
        const live = await tx.recordRow.findUnique({
          where: { id: record.id },
        });
        if (!live) {
          return {
            output: {
              stepId: step.id,
              type: 'condition',
              values: { 条件结果: 'false', 原因: '对照记录不存在' },
            },
            skipRest: true,
          };
        }
        cells = (live.cells ?? {}) as Record<string, unknown>;
        sheetIdForFields = live.sheetId;
      } else if (record) {
        cells = record.cells;
        sheetIdForFields = record.sheetId;
      } else {
        return {
          output: {
            stepId: step.id,
            type: 'condition',
            values: { 条件结果: 'false', 原因: '对照步骤无记录' },
          },
          skipRest: true,
        };
      }
    } else if (state.triggerRecordId) {
      const live = await tx.recordRow.findUnique({
        where: { id: state.triggerRecordId },
      });
      if (live) {
        cells = (live.cells ?? {}) as Record<string, unknown>;
        sheetIdForFields = live.sheetId;
      }
    }

    if (!sheetIdForFields) {
      const anyFieldId = step.filters.conditions.find(
        (node: FilterGroup['conditions'][number]) =>
          !Array.isArray((node as FilterGroup).conditions),
      ) as { fieldId?: string } | undefined;
      if (anyFieldId?.fieldId) {
        const field = await tx.field.findUnique({
          where: { id: anyFieldId.fieldId },
          select: { sheetId: true },
        });
        sheetIdForFields = field?.sheetId;
      }
    }

    let fields: Field[] = [];
    if (sheetIdForFields) {
      fields = await tx.field.findMany({ where: { sheetId: sheetIdForFields } });
    } else {
      // 用触发记录的字段名映射：把 name→临时伪 field 不够；改为按 name 匹配 cells key
      fields = [...state.triggerByName.keys()].map(
        (name, index) =>
          ({
            id: name,
            name,
            sheetId: '',
            type: 'text',
            order: index,
          }) as Field,
      );
      // cells keyed by field id — also project name keys
      const byName: Record<string, unknown> = {};
      for (const [name, value] of state.triggerByName) {
        byName[name] = value;
      }
      cells = { ...cells, ...byName };
    }

    const normalized = this.normalizeFilterFieldIds(step.filters, fields);
    const matched = evaluateFilterGroup(normalized, cells);
    return {
      output: {
        stepId: step.id,
        type: 'condition',
        values: { 条件结果: matched ? 'true' : 'false' },
      },
      skipRest: !matched,
    };
  }

  private runDelay(step: DelayStep): StepExecution {
    const delayMs = Math.max(0, Math.floor(step.delayMs || 0));
    return {
      output: {
        stepId: step.id,
        type: 'delay',
        values: { 延迟毫秒: String(delayMs) },
      },
      delayMs,
    };
  }

  private async findRecords(
    step: FindRecordsStep,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const fields = await this.fieldsOfSheet(tx, step.sheetId);
    const limit = resolveFindLimit(step);
    const where = step.filters
      ? buildFilterSql(step.filters)
      : Prisma.sql`TRUE`;
    const claimStatus = this.claimStatusPredicate(step, fields);
    const order = buildSortSql(
      step.sorts,
      fields.map((field) => ({
        id: field.id,
        type: field.type,
        options: field.options as {
          choices?: Array<{ id?: unknown; name?: unknown }>;
        } | null,
      })),
    );
    const lock = this.stepFeedsModify(step.id, state.automation.steps)
      ? Prisma.sql`FOR UPDATE SKIP LOCKED`
      : Prisma.sql``;

    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "records" WHERE "sheet_id" = ${step.sheetId}::uuid AND (${where}) ${claimStatus} ${order} LIMIT ${limit} ${lock}`,
    );

    if (rows.length === 0) {
      const behavior = resolveOnEmpty(step, state.automation);
      return {
        output: {
          stepId: step.id,
          type: 'findRecords',
          records: [],
          recordIds: [],
          values: {},
        },
        stop: behavior === 'stop',
      };
    }

    const ids = rows.map((row) => row.id);
    const records = await tx.recordRow.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    const ordered = ids.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });

    return {
      output: {
        stepId: step.id,
        type: 'findRecords',
        records: ordered.map((record) => this.toRecordOutput(record)),
        recordIds: ordered.map((record) => record.id),
        values: ordered.length
          ? this.flattenRecord(ordered[0], fields)
          : {},
      },
    };
  }

  private async createRecord(
    step: Extract<AutomationStep, { type: 'createRecord' }>,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const fields = await this.fieldsOfSheet(tx, step.sheetId);
    const cells = await this.resolveCells(step.cells, state, fields);
    const created = await tx.recordRow.create({
      data: {
        sheetId: step.sheetId,
        cells: cells as Prisma.InputJsonValue,
        claimStatus: this.deriveClaimStatus(cells, fields),
      },
    });

    return {
      output: {
        stepId: step.id,
        type: 'createRecord',
        records: [this.toRecordOutput(created)],
        recordIds: [created.id],
        values: this.flattenRecord(created, fields),
      },
    };
  }

  private async modifyRecords(
    step: ModifyRecordsStep,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const ids = await this.resolveTargetIds(step, state, tx);
    if (ids.length === 0) {
      return {
        output: {
          stepId: step.id,
          type: 'modifyRecords',
          records: [],
          recordIds: [],
          values: {},
        },
      };
    }

    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "records" WHERE id IN (${Prisma.join(
        ids.map((id) => Prisma.sql`${id}::uuid`),
      )}) FOR UPDATE`,
    );

    const records = await tx.recordRow.findMany({
      where: { id: { in: ids } },
    });
    const updated: RecordRow[] = [];
    // Cache field defs per sheet — WeCom update_record applies one mapping
    // shape; avoid N+1 field loads when claiming many ids in one step.
    const fieldsBySheet = new Map<string, Field[]>();
    let lastFields: Field[] = [];

    for (const record of records) {
      let fields = fieldsBySheet.get(record.sheetId);
      if (!fields) {
        fields = await this.fieldsOfSheet(tx, record.sheetId);
        fieldsBySheet.set(record.sheetId, fields);
      }
      lastFields = fields;
      const pending = await this.resolveCells(step.cells, state, fields);
      const current = (record.cells ?? {}) as Record<string, unknown>;
      const merged = { ...current, ...pending };

      updated.push(
        await tx.recordRow.update({
          where: { id: record.id },
          data: {
            cells: merged as Prisma.InputJsonValue,
            version: { increment: 1 },
            claimStatus: this.deriveClaimStatus(merged, fields),
          },
        }),
      );
    }

    return {
      output: {
        stepId: step.id,
        type: 'modifyRecords',
        records: updated.map((record) => this.toRecordOutput(record)),
        recordIds: updated.map((record) => record.id),
        values: updated.length
          ? this.flattenRecord(updated[0], lastFields)
          : {},
      },
    };
  }

  private async sendMessage(
    step: Extract<AutomationStep, { type: 'sendMessage' }>,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const text = this.interpolate(step.content.text, state);
    const title = step.name ?? '自动化通知';
    const recipients = await this.resolveRecipients(step, state, tx);
    const buttons = (step.content.buttons ?? []).map((button) => ({
      title: this.interpolate(button.title, state),
      url: this.interpolate(button.url, state),
    }));
    const data = {
      automationId: state.automation.id,
      buttons,
    } as unknown as Prisma.InputJsonValue;

    for (const userId of recipients) {
      await tx.notification.create({
        data: { userId, title, body: text, data },
      });
    }
    try {
      await this.notify.sendMessage({
        userIds: recipients,
        title,
        text,
      });
    } catch (error) {
      this.logger.warn(
        `external notify failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      output: {
        stepId: step.id,
        type: 'sendMessage',
        values: {
          消息标题: title,
          消息内容: text,
        },
      },
    };
  }

  private async sendHttp(
    step: Extract<AutomationStep, { type: 'sendHttp' }>,
    state: ExecutionState,
  ): Promise<StepExecution> {
    const url = this.interpolate(step.url, state).trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('HTTP 请求 URL 必须以 http:// 或 https:// 开头');
    }
    const method = (step.method ?? 'GET').toUpperCase();
    const timeoutMs = Math.min(
      Math.max(step.timeoutMs ?? 15_000, 1_000),
      60_000,
    );
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.headers ?? {})) {
      headers[key] = this.interpolate(String(value), state);
    }
    const body =
      method === 'GET' || method === 'DELETE'
        ? undefined
        : this.interpolate(step.body ?? '', state);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status = 0;
    let responseText = '';
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body || undefined,
        signal: controller.signal,
      });
      status = response.status;
      responseText = (await response.text()).slice(0, 8_192);
      if (!response.ok) {
        throw new Error(`HTTP ${status}: ${responseText.slice(0, 200)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`HTTP 请求超时（${timeoutMs}ms）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    return {
      output: {
        stepId: step.id,
        type: 'sendHttp',
        values: {
          状态码: String(status),
          响应: responseText,
        },
      },
    };
  }

  private async resolveTargetIds(
    step: ModifyRecordsStep,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    if (step.target.mode === 'fromStep') {
      return state.stepOutputs.get(step.target.stepId)?.recordIds ?? [];
    }
    if (step.target.mode === 'ids') {
      return step.target.recordIds ?? [];
    }

    const where = buildFilterSql(step.target.filters);
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "records" WHERE "sheet_id" = ${step.target.sheetId}::uuid AND (${where}) ORDER BY id ASC LIMIT 1000`,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Claim lookups filter on the JSONB status cell, but the index lives on the
   * side column. When the filter is an equality on 状态/领取状态, add the
   * equivalent claim_status predicate so Postgres can use
   * records(sheet_id, claim_status) without a sequential scan.
   */
  private claimStatusPredicate(
    step: FindRecordsStep,
    fields: Field[],
  ): Prisma.Sql {
    const statusField = fields.find(
      (field) => field.name === '状态' || field.name === '领取状态',
    );
    if (!statusField || !step.filters) return Prisma.sql``;

    const value = this.findEqualsValue(step.filters, statusField.id);
    if (value === undefined) return Prisma.sql``;

    const status = this.normalizeClaimStatus(value, statusField.options);
    return status ? Prisma.sql`AND "claim_status" = ${status}` : Prisma.sql``;
  }

  private findEqualsValue(
    group: unknown,
    fieldId: string,
  ): unknown | undefined {
    if (!group || typeof group !== 'object') return undefined;
    const candidate = group as {
      conditions?: unknown[];
      groups?: unknown[];
    };
    for (const condition of candidate.conditions ?? []) {
      const match = condition as {
        fieldId?: string;
        operator?: string;
        value?: unknown;
      };
      if (match.fieldId === fieldId && match.operator === 'equals') {
        return match.value;
      }
    }
    for (const nested of candidate.groups ?? []) {
      const found = this.findEqualsValue(nested, fieldId);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  private normalizeClaimStatus(
    value: unknown,
    options: unknown,
  ): 'claimed' | 'unclaimed' | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const choices = (
      options as { choices?: Array<{ id?: unknown; name?: unknown }> } | null
    )?.choices;
    const choice = Array.isArray(choices)
      ? choices.find(
          (item) => item.id === raw || item.name === raw,
        )
      : undefined;
    const normalized = String(choice?.name ?? raw);

    if (['unclaimed', '未领', '未领取', '待领取'].includes(normalized)) {
      return 'unclaimed';
    }
    if (['claimed', '已领', '已领取'].includes(normalized)) {
      return 'claimed';
    }
    return null;
  }

  private async resolveCells(    mapping: CellMapping,
    state: ExecutionState,
    fields: Field[],
  ): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};
    for (const [key, expression] of Object.entries(mapping ?? {})) {
      const field =
        fields.find((item) => item.id === key) ??
        fields.find((item) => item.name === key);
      resolved[field?.id ?? key] = this.resolveExpression(expression, state);
    }
    return resolved;
  }

  private resolveExpression(
    expression: StepValueExpression,
    state: ExecutionState,
  ): unknown {
    if (expression.kind === 'literal') return expression.value;
    const variable = expression.variable;

    if (variable.source === 'naturalTime') {
      return this.naturalTime(variable.naturalTime);
    }

    if (variable.source === 'trigger') {
      if (variable.field && state.triggerByName.has(variable.field)) {
        return state.triggerByName.get(variable.field);
      }
      return variable.field
        ? state.triggerCells[variable.field]
        : undefined;
    }

    const output = variable.stepId
      ? state.stepOutputs.get(variable.stepId)
      : [...state.stepOutputs.values()][(variable.stepIndex ?? 1) - 1];
    if (!output) return undefined;
    if (variable.path === 'recordIds') return output.recordIds;
    if (variable.field && output.values?.[variable.field] !== undefined) {
      return output.values[variable.field];
    }
    const record = output.records?.[0];
    if (!record) return undefined;
    if (variable.field) {
      return record.cells[variable.field] ?? output.values?.[variable.field];
    }
    return record;
  }

  private naturalTime(kind: string | undefined): string {
    const now = new Date();
    const day = 86_400_000;
    // WeCom message/title templates use wall-clock「操作时间」; claim stamps
    // need datetime, not date-only「今天」.
    if (kind === 'now') {
      return now.toISOString().replace('T', ' ').slice(0, 19);
    }
    if (kind === 'tomorrow') {
      return new Date(now.getTime() + day).toISOString().slice(0, 10);
    }
    if (kind === 'yesterday') {
      return new Date(now.getTime() - day).toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
  }

  private interpolate(text: string, state: ExecutionState): string {
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey: string) => {
      const key = rawKey.trim();
      if (key === '今天' || key === '明天' || key === '昨天') {
        return this.naturalTime(
          key === '明天' ? 'tomorrow' : key === '昨天' ? 'yesterday' : 'today',
        );
      }
      // 「第N步.字段」：第1步=触发记录，第2步起=执行步骤（与编辑器序号一致）。
      const stepMatch = /^第(\d+)步[·.\s]*(.+)$/.exec(key);
      if (stepMatch) {
        const stepNo = Number(stepMatch[1]);
        const field = stepMatch[2].trim();
        if (stepNo === 1) {
          if (state.triggerByName.has(field)) {
            return String(state.triggerByName.get(field));
          }
          if (Object.prototype.hasOwnProperty.call(state.flatValues, field)) {
            return state.flatValues[field];
          }
        } else if (stepNo >= 2) {
          const outputs = [...state.stepOutputs.values()];
          const output = outputs[stepNo - 2];
          if (output?.values?.[field] !== undefined) {
            return String(output.values[field]);
          }
        }
      }
      if (Object.prototype.hasOwnProperty.call(state.flatValues, key)) {
        return state.flatValues[key];
      }
      if (state.triggerByName.has(key)) {
        return String(state.triggerByName.get(key));
      }
      return match;
    });
  }

  private async resolveRecipients(
    step: Extract<AutomationStep, { type: 'sendMessage' }>,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const ids = new Set<string>();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const recipient of step.recipients ?? []) {
      for (const id of recipient.userIds ?? []) {
        if (uuid.test(id)) ids.add(id);
      }
      if (recipient.source === 'trigger' || recipient.source === 'step') {
        const value =
          recipient.source === 'trigger'
            ? recipient.field
              ? state.triggerByName.get(recipient.field)
              : undefined
            : recipient.field && recipient.stepId
              ? state.stepOutputs.get(recipient.stepId)?.values?.[
                  recipient.field
                ]
              : undefined;
        if (typeof value === 'string' && uuid.test(value)) ids.add(value);
      }
    }

    if (ids.size === 0 && state.triggerUser) {
      ids.add(state.triggerUser);
    }

    if (ids.size === 0) {
      // Fall back to base editors so notifications are never silently dropped.
      const base = await tx.base.findUnique({
        where: { id: state.automation.baseId },
        include: {
          workspace: {
            include: {
              members: {
                where: {
                  role: { in: [WorkspaceRole.owner, WorkspaceRole.admin] },
                },
              },
            },
          },
        },
      });
      for (const member of base?.workspace.members ?? []) {
        ids.add(member.userId);
      }
    }

    return [...ids];
  }

  private stepFeedsModify(stepId: string, steps: AutomationStep[]): boolean {
    return steps.some(
      (step) =>
        step.type === 'modifyRecords' &&
        step.target.mode === 'fromStep' &&
        step.target.stepId === stepId,
    );
  }

  private async fieldsOfSheet(
    tx: Prisma.TransactionClient,
    sheetId: string,
  ): Promise<Field[]> {
    return tx.field.findMany({ where: { sheetId }, orderBy: { order: 'asc' } });
  }

  private toRecordOutput(record: RecordRow) {
    return {
      id: record.id,
      sheetId: record.sheetId,
      cells: (record.cells ?? {}) as Record<string, unknown>,
    };
  }

  private flattenRecord(
    record: RecordRow,
    fields: Field[],
  ): Record<string, string> {
    const cells = (record.cells ?? {}) as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const field of fields) {
      const raw = cells[field.id];
      if (raw === undefined || raw === null || raw === '') continue;
      values[field.name] = this.displayValue(field, raw);
    }
    return values;
  }

  private displayValue(field: Field, raw: unknown): string {
    const options = (field.options ?? {}) as {
      choices?: Array<{ id: string; name: string }>;
    };

    if (field.type === 'multiSelect' && Array.isArray(raw)) {
      return raw
        .map((item) => this.optionName(options, item))
        .filter((item) => item !== '')
        .join(', ');
    }
    if (field.type === 'select') {
      return this.optionName(options, raw);
    }
    if (typeof raw === 'object') return JSON.stringify(raw);
    return String(raw);
  }

  private optionName(
    options: { choices?: Array<{ id: string; name: string }> },
    raw: unknown,
  ): string {
    const choice = options.choices?.find(
      (item) => item.id === raw || item.name === raw,
    );
    return choice?.name ?? String(raw ?? '');
  }

  private deriveClaimStatus(
    cells: Record<string, unknown>,
    fields: Field[],
  ): string | null {
    const statusField = fields.find(
      (field) => field.name === '状态' || field.name === '领取状态',
    );
    if (!statusField) return null;
    const raw = cells[statusField.id];
    if (raw === undefined || raw === null) return null;
    const options = (statusField.options ?? {}) as {
      choices?: Array<{ id: string; name: string }>;
    };
    const name = this.optionName(options, raw);
    if (['已领', '已领取', 'claimed'].includes(name)) return 'claimed';
    if (['未领', '未领取', 'unclaimed'].includes(name)) return 'unclaimed';
    return null;
  }

  private toDefinition(automation: Automation): AutomationDefinition {
    return {
      id: automation.id,
      baseId: automation.baseId,
      name: automation.name,
      enabled: automation.enabled,
      trigger: automation.trigger as unknown as AutomationTrigger,
      steps: automation.steps as unknown as AutomationStep[],
      onFindEmpty: automation.onFindEmpty as FindEmptyBehavior,
      monthlyQuota: automation.monthlyQuota ?? undefined,
    };
  }

  private resultFromRun(
    run: { id: string; status: string; outputs: Prisma.JsonValue },
  ): AutomationRunResult {
    return {
      runId: run.id,
      status: run.status as AutomationRunStatus,
      stepOutputs: (run.outputs ?? {}) as Record<string, string>,
      outputs: [],
    };
  }
}
