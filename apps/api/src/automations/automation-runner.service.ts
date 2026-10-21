import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
  type FilterGroup,
  type FindEmptyBehavior,
  type FindRecordsStep,
  type ModifyRecordsStep,
  type StepOutput,
  type StepValueExpression,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFilterSql,
  buildSortSql,
} from './automation-filter.sql';
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
}

type InternalStepOutput = StepOutput & { groupChatId?: string };

interface ExecutionState {
  automation: AutomationDefinition;
  triggerCells: Record<string, unknown>;
  triggerByName: Map<string, unknown>;
  triggerUser?: string;
  stepOutputs: Map<string, InternalStepOutput>;
  flatValues: Record<string, string>;
}

interface StepExecution {
  output: InternalStepOutput;
  stop?: boolean;
}

@Injectable()
export class AutomationRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFY_ADAPTER) private readonly notify: NotifyAdapter,
  ) {}

  async runAutomation(
    automationId: string,
    context: AutomationRunContext = {},
    outerTx?: Prisma.TransactionClient,
  ): Promise<AutomationRunResult> {
    if (outerTx) {
      return this.execute(automationId, context, outerTx);
    }

    try {
      return await this.prisma.$transaction(
        (tx) => this.execute(automationId, context, tx),
        { timeout: 15_000 },
      );
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

  /** Runs every enabled automation whose recordCreated trigger matches. */
  async triggerRecordCreated(
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
  ): Promise<AutomationRunResult[]> {
    return this.triggerRecord(
      'recordCreated',
      recordId,
      outerTx,
      idempotencyKey,
    );
  }

  async triggerRecordUpdated(
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
  ): Promise<AutomationRunResult[]> {
    return this.triggerRecord(
      'recordUpdated',
      recordId,
      outerTx,
      idempotencyKey,
    );
  }

  private async triggerRecord(
    type: 'recordCreated' | 'recordUpdated',
    recordId: string,
    outerTx?: Prisma.TransactionClient,
    idempotencyKey?: string,
  ): Promise<AutomationRunResult[]> {
    const db = outerTx ?? this.prisma;
    const record = await db.recordRow.findUnique({ where: { id: recordId } });
    if (!record) return [];

    const fields = await db.field.findMany({
      where: { sheetId: record.sheetId },
    });
    const cells = (record.cells ?? {}) as Record<string, unknown>;
    const automations = await db.automation.findMany({
      where: { enabled: true },
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
  ): Promise<AutomationRunResult> {
    const automation = await tx.automation.findUnique({
      where: { id: automationId },
    });
    if (!automation) {
      throw new NotFoundException('自动化不存在');
    }

    const definition = this.toDefinition(automation);

    if (context.idempotencyKey) {
      const existing = await tx.automationRun.findUnique({
        where: {
          automationId_idempotencyKey: {
            automationId,
            idempotencyKey: context.idempotencyKey,
          },
        },
      });
      if (existing?.status === 'success') {
        return this.resultFromRun(existing);
      }
    }

    const startedAt = new Date();
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

    if (!definition.enabled) {
      return {
        runId: run.id,
        status: 'skipped',
        stepOutputs: {},
        outputs: [],
      };
    }

    const state = await this.buildState(definition, context, tx);
    const outputs: InternalStepOutput[] = [];
    let status: AutomationRunStatus = 'success';
    let errorMessage: string | undefined;

    for (let index = 0; index < definition.steps.length; index += 1) {
      const step = definition.steps[index];
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
          runId: run.id,
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
    }

    const durationMs = Date.now() - startedAt.getTime();
    await tx.automationRun.update({
      where: { id: run.id },
      data: {
        status,
        outputs: state.flatValues as Prisma.InputJsonValue,
        error: errorMessage ?? null,
        finishedAt: new Date(),
        durationMs,
      },
    });

    return {
      runId: run.id,
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

    return {
      automation: definition,
      triggerCells,
      triggerByName,
      triggerUser: context.submitterUserId,
      stepOutputs: new Map(),
      flatValues: {},
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
      case 'startGroupChat':
        return this.startGroupChat(step, state, tx);
      case 'addGroupMembers':
        return this.addGroupMembers(step, state, tx);
      default:
        throw new Error(
          `未知自动化步骤: ${(step as { type: string }).type}`,
        );
    }
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
    const order = buildSortSql(step.sorts);
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
    let lastFields: Field[] = [];

    for (const record of records) {
      const fields = await this.fieldsOfSheet(tx, record.sheetId);
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
    const data = {
      automationId: state.automation.id,
      buttons: step.content.buttons ?? [],
    } as unknown as Prisma.InputJsonValue;

    for (const userId of recipients) {
      await tx.notification.create({
        data: { userId, title, body: text, data },
      });
    }

    return {
      output: {
        stepId: step.id,
        type: 'sendMessage',
        values: { 消息内容: text },
      },
    };
  }

  private async startGroupChat(
    step: Extract<AutomationStep, { type: 'startGroupChat' }>,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const { groupChatId } = await this.notify.startGroupChat({
      baseId: state.automation.baseId,
      name: step.name,
      memberIds: step.memberUserIds ?? [],
    });

    return {
      output: { stepId: step.id, type: 'startGroupChat', groupChatId },
    };
  }

  private async addGroupMembers(
    step: Extract<AutomationStep, { type: 'addGroupMembers' }>,
    state: ExecutionState,
    tx: Prisma.TransactionClient,
  ): Promise<StepExecution> {
    const fromStep = step.fromStepId
      ? (state.stepOutputs.get(step.fromStepId)?.groupChatId ?? undefined)
      : undefined;
    const groupChatId = step.groupChatId ?? fromStep;
    if (!groupChatId) {
      throw new Error('未找到目标群聊');
    }

    await this.notify.addGroupMembers({
      groupChatId,
      memberIds: step.memberUserIds ?? [],
    });
    return { output: { stepId: step.id, type: 'addGroupMembers', groupChatId } };
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
