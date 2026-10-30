import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Form } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { randomBytes, randomUUID } from 'node:crypto';
import * as QRCode from 'qrcode';
import {
  buildSuccessValues,
  escapeHtml,
  isDisplayConditionRule,
  isFormFieldVisible,
  isFormFillableFieldType,
  normalizeDisplayRule,
  renderSuccessTemplate,
  walkDisplayConditionLeaves,
  type DisplayConditionRule,
  type FormFieldConfig,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisConnection } from '../queue/redis-connection';
import { AutomationRunnerService } from '../automations/automation-runner.service';
import { LiveBusService } from '../live/live-bus.service';
import { MetricsService } from '../metrics/metrics.service';
import { PermissionsService } from '../permissions/permissions.service';
import { QuotasService } from '../quotas/quotas.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type {
  PreviewSuccessDto,
  UpsertFormDto,
} from './dto/form-config.dto';
import {
  applyAutoNumbers,
  stripAutoNumberInputs,
} from '../sheets/auto-number';
import {
  applyAiFields,
  stripAiFieldInputs,
} from '../sheets/ai-field';

interface ShareConfig {
  enabled?: boolean;
  audience?: 'anyone' | 'workspace';
  expiresAt?: string | null;
}

type SubmissionForm = Prisma.FormGetPayload<{
  include: { sheet: { include: { fields: true } } };
}>;

const SUBMISSION_QUEUE = 'form-submissions';

@Injectable()
export class FormsService implements OnModuleDestroy {
  private readonly logger = new Logger(FormsService.name);
  private readonly publicBase: string;
  private readonly submitLimit: number;
  private readonly submitHits = new Map<string, number[]>();
  private readonly submitMode: 'sync' | 'queue';
  private readonly queue: Queue | null = null;
  private readonly worker: Worker | null = null;
  private readonly queueConnection: IORedis | null = null;
  private readonly workerConnection: IORedis | null = null;
  /** Shared rate-limit client (multi-replica). Falls back to process Map. */
  private readonly rateLimitRedis: IORedis | null = null;
  /**
   * Admission control: a single API replica must not push every simultaneous
   * HTTP submit into Prisma at once. Queued requests are still accepted and
   * complete as soon as a slot opens; horizontal replicas scale the ceiling.
   */
  private readonly submitMaxConcurrency: number;
  private activeSubmits = 0;
  private readonly submitWaiters: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
    private readonly automationRunner: AutomationRunnerService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly quotas: QuotasService,
    private readonly live: LiveBusService,
  ) {
    this.publicBase = (
      this.config.get<string>('PUBLIC_FORM_BASE_URL') ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    this.submitLimit = Number(
      this.config.get<string>('PUBLIC_SUBMIT_RATE_LIMIT') ?? 30,
    );
    this.submitMode =
      this.config.get<string>('SUBMIT_MODE') === 'queue' ? 'queue' : 'sync';
    this.submitMaxConcurrency = Math.max(
      1,
      Number(this.config.get<string>('SUBMIT_MAX_CONCURRENCY') ?? 64),
    );

    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      try {
        this.rateLimitRedis = createRedisConnection(redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeoutMs: 3_000,
        });
        this.rateLimitRedis.on('error', (error) => {
          this.logger.warn(`form rate-limit Redis error: ${String(error)}`);
        });
      } catch (error) {
        this.logger.warn(
          `form rate-limit Redis unavailable, memory-only: ${String(error)}`,
        );
      }
    }

    if (this.submitMode === 'queue') {
      const url =
        redisUrl ??
        this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
      this.queueConnection = createRedisConnection(url);
      this.workerConnection = createRedisConnection(url);
      this.queue = new Queue(SUBMISSION_QUEUE, {
        connection: this.queueConnection,
      });
      this.worker = new Worker(
        SUBMISSION_QUEUE,
        async (job) => {
          await this.processQueuedSubmission(
            (job.data as { submissionId: string }).submissionId,
          );
        },
        { connection: this.workerConnection, concurrency: 8 },
      );
      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `submission job ${job?.id ?? 'unknown'} failed: ${error.message}`,
        );
      });
    }
  }

  async upsert(formId: string, userId: string, dto: UpsertFormDto) {
    const existing = await this.prisma.form.findUnique({
      where: { id: formId },
    });
    const baseId = existing?.baseId ?? dto.baseId;

    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    if (existing) {
      // update + share config: content ACL on the form object
      await this.permissions.assertCan('form', formId, userId, 'update');
    } else {
      await this.workspacesService.requireMember(
        base.workspaceId,
        userId,
        'editor',
      );
    }

    if (existing && dto.baseId !== existing.baseId) {
      throw new BadRequestException('不能跨 Base 移动表单');
    }

    const sheet = await this.prisma.sheet.findUnique({
      where: { id: dto.sheetId },
      include: { fields: true },
    });
    if (!sheet || sheet.baseId !== baseId) {
      throw new BadRequestException('工作表不属于该 Base');
    }

    const sheetFieldIds = new Set(sheet.fields.map((field) => field.id));
    const configured = dto.fields;
    const seen = new Set<string>();
    for (const field of configured) {
      if (!sheetFieldIds.has(field.fieldId)) {
        throw new BadRequestException(`字段不属于该工作表: ${field.fieldId}`);
      }
      const sheetField = sheet.fields.find((item) => item.id === field.fieldId);
      if (sheetField && !isFormFillableFieldType(sheetField.type)) {
        throw new BadRequestException(
          `「${sheetField.name}」是${sheetField.type}类型，不能加入收集表单`,
        );
      }
      if (seen.has(field.fieldId)) {
        throw new BadRequestException('表单字段重复');
      }
      seen.add(field.fieldId);
      this.assertDisplayTriggers(
        {
          displayConditions: field.displayConditions,
          displayRule: field.displayRule as DisplayConditionRule | undefined,
        },
        sheet.fields,
        sheetFieldIds,
      );
    }

    const share: ShareConfig = {
      enabled: dto.share?.enabled ?? true,
      audience: dto.share?.audience ?? 'anyone',
      expiresAt: dto.share?.expiresAt ?? null,
    };
    const successTemplate =
      dto.successPage?.templateHtml ??
      existing?.successTemplate ??
      '提交成功，你的序列号是 {{序列号}}';

    if (existing) {
      const updated = await this.prisma.form.update({
        where: { id: formId },
        data: {
          sheetId: dto.sheetId,
          name: dto.name.trim(),
          coverUrl:
            dto.coverUrl === undefined ? existing.coverUrl : dto.coverUrl,
          fields: configured as unknown as Prisma.InputJsonValue,
          share: share as unknown as Prisma.InputJsonValue,
          successTemplate,
          rejectDuplicatePhone:
            dto.rejectDuplicatePhone ?? existing.rejectDuplicatePhone,
          duplicateCheckFieldId: this.resolveDuplicateCheckFieldId(
            dto,
            configured,
            sheet.fields,
            existing.duplicateCheckFieldId,
          ),
        },
      });
      await this.live.emit({
        baseId: updated.baseId,
        actorId: userId,
        kind: 'form.updated',
        entityId: updated.id,
        meta: { name: updated.name },
      });
      if (share.enabled) {
        await this.live.emit({
          baseId: updated.baseId,
          actorId: userId,
          kind: 'form.published',
          entityId: updated.id,
          meta: { name: updated.name },
        });
      }
      return this.toDto(updated);
    }

    const created = await this.prisma.form.create({
      data: {
        id: formId,
        baseId,
        sheetId: dto.sheetId,
        name: dto.name.trim(),
        coverUrl: dto.coverUrl ?? null,
        fields: configured as unknown as Prisma.InputJsonValue,
        share: share as unknown as Prisma.InputJsonValue,
        shareToken: randomBytes(12).toString('base64url'),
        successTemplate,
        rejectDuplicatePhone: dto.rejectDuplicatePhone ?? true,
        duplicateCheckFieldId: this.resolveDuplicateCheckFieldId(
          dto,
          configured,
          sheet.fields,
          null,
        ),
      },
    });
    await this.live.emit({
      baseId: created.baseId,
      actorId: userId,
      kind: 'form.created',
      entityId: created.id,
      meta: { name: created.name },
    });
    if (share.enabled) {
      await this.live.emit({
        baseId: created.baseId,
        actorId: userId,
        kind: 'form.published',
        entityId: created.id,
        meta: { name: created.name },
      });
    }
    return this.toDto(created);
  }

  async getForOwner(formId: string, userId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.permissions.assertCan('form', formId, userId, 'read');
    return this.toDto(form);
  }

  async listByBase(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'viewer',
    );
    const forms = await this.prisma.form.findMany({
      where: { baseId },
      orderBy: { createdAt: 'asc' },
    });
    const visible = [];
    for (const form of forms) {
      const decision = await this.permissions.decision('form', form.id, userId);
      if (decision.level === 'none') continue;
      visible.push(form);
    }
    return Promise.all(visible.map((form) => this.toDto(form)));
  }

  async delete(formId: string, userId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.permissions.assertCan('form', formId, userId, 'delete');
    const baseId = form.baseId;
    await this.prisma.form.delete({ where: { id: formId } });
    await this.live.emit({
      baseId,
      actorId: userId,
      kind: 'form.deleted',
      entityId: formId,
    });
    return { id: formId, deleted: true };
  }

  async uploadCover(
    formId: string,
    userId: string,
    buffer: Buffer,
    mimetype: string,
  ) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { base: true },
    });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.permissions.assertCan('form', formId, userId, 'update');

    await this.quotas.assertStorage(form.base.workspaceId, buffer.byteLength);
    const coverUrl = await this.storage.saveCover(buffer, mimetype);
    await this.quotas.recordStorage(
      form.base.workspaceId,
      coverUrl,
      buffer.byteLength,
    );
    const updated = await this.prisma.form.update({
      where: { id: formId },
      data: { coverUrl },
    });
    await this.live.emit({
      baseId: form.baseId,
      actorId: userId,
      kind: 'form.updated',
      entityId: formId,
      meta: { coverUrl: updated.coverUrl },
    });
    return { coverUrl: updated.coverUrl };
  }

  async getPublic(shareToken: string) {
    const form = await this.prisma.form.findUnique({
      where: { shareToken },
      include: {
        sheet: { include: { fields: true } },
        base: true,
      },
    });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    this.assertShareOpen(form);

    const configured = form.fields as unknown as FormFieldConfig[];
    const fieldById = new Map(
      form.sheet.fields.map((field) => [field.id, field]),
    );

    // Return every configured fillable field: the public client re-evaluates
    // display conditions as the respondent fills. Computed/system types are
    // omitted (not user-fillable).
    const fields = configured.flatMap((config) => {
      const field = fieldById.get(config.fieldId);
      if (!field || !isFormFillableFieldType(field.type)) return [];
      return [
        {
          fieldId: field.id,
          name: field.name,
          type: field.type,
          options: field.options,
          required: Boolean(config.required),
          displayConditions: config.displayConditions ?? [],
          displayRule: config.displayRule ?? normalizeDisplayRule(config) ?? undefined,
        },
      ];
    });

    const needsMembers = fields.some((field) => field.type === 'person');
    const members = needsMembers
      ? (
          await this.prisma.workspaceMember.findMany({
            where: { workspaceId: form.base.workspaceId },
            include: { user: { select: { id: true, account: true } } },
            take: 500,
          })
        ).map((item) => ({
          userId: item.user.id,
          account: item.user.account,
        }))
      : [];

    const relationChoices: Record<
      string,
      Array<{ id: string; label: string }>
    > = {};
    for (const field of fields) {
      if (field.type !== 'relation') continue;
      const targetSheetId = (
        field.options as { relation?: { targetSheetId?: string } } | null
      )?.relation?.targetSheetId;
      if (!targetSheetId) {
        relationChoices[field.fieldId] = [];
        continue;
      }
      relationChoices[field.fieldId] = await this.listRelationChoices(
        targetSheetId,
      );
    }

    return {
      id: form.id,
      name: form.name,
      coverUrl: form.coverUrl,
      qrUrl: `${this.publicBase}/fill/${form.shareToken}`,
      fields,
      members,
      relationChoices,
    };
  }

  /** Public fill: upload image/file for a form field without login. */
  async uploadPublicAttachment(
    shareToken: string,
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ) {
    const form = await this.prisma.form.findUnique({
      where: { shareToken },
      include: { base: true },
    });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    this.assertShareOpen(form);

    await this.quotas.assertStorage(form.base.workspaceId, buffer.byteLength);
    const saved = await this.storage.saveUpload(
      buffer,
      mimetype,
      originalName,
    );
    await this.quotas.recordStorage(
      form.base.workspaceId,
      saved.key,
      saved.size,
    );
    return {
      url: saved.url,
      name: saved.name,
      mimetype: saved.mimetype,
      size: saved.size,
    };
  }

  private async listRelationChoices(
    targetSheetId: string,
  ): Promise<Array<{ id: string; label: string }>> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: targetSheetId },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
    if (!sheet) return [];
    const titleField =
      sheet.fields.find((item) => item.type === 'text' || item.type === 'title') ??
      sheet.fields[0] ??
      null;
    const records = await this.prisma.recordRow.findMany({
      where: { sheetId: targetSheetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return records.map((record) => {
      const cells = (record.cells ?? {}) as Record<string, unknown>;
      const raw = titleField ? cells[titleField.id] : null;
      const label =
        raw === null || raw === undefined || raw === ''
          ? record.id.slice(0, 8)
          : String(raw);
      return { id: record.id, label };
    });
  }

  async submit(
    shareToken: string,
    cells: Record<string, unknown>,
    ip: string,
    submitterUserId?: string,
  ) {
    await this.acquireSubmitSlot();
    try {
      return await this.submitWithSlot(
        shareToken,
        cells,
        ip,
        submitterUserId,
      );
    } finally {
      this.releaseSubmitSlot();
    }
  }

  /** 公开提交 + Idempotency-Key（离线回放防领码双花） */
  async submitIdempotent(
    shareToken: string,
    cells: Record<string, unknown>,
    ip: string,
    submitterUserId?: string,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const prior = await this.prisma.formSubmitIdempotency.findUnique({
        where: { idempotencyKey },
      });
      if (prior) {
        return prior.result as Awaited<ReturnType<FormsService['submit']>>;
      }
    }
    const result = await this.submit(
      shareToken,
      cells,
      ip,
      submitterUserId,
    );
    if (idempotencyKey) {
      const form = await this.prisma.form.findUnique({
        where: { shareToken },
      });
      if (form) {
        await this.prisma.formSubmitIdempotency.create({
          data: {
            idempotencyKey,
            formId: form.id,
            submissionId:
              (result as { submissionId?: string }).submissionId ?? null,
            result: result as object,
          },
        });
      }
    }
    return result;
  }

  private async acquireSubmitSlot(): Promise<void> {
    if (this.activeSubmits < this.submitMaxConcurrency) {
      this.activeSubmits += 1;
      return;
    }
    await new Promise<void>((resolve) => this.submitWaiters.push(resolve));
  }

  private releaseSubmitSlot(): void {
    this.activeSubmits -= 1;
    const next = this.submitWaiters.shift();
    if (next) {
      this.activeSubmits += 1;
      next();
    }
  }

  private async submitWithSlot(
    shareToken: string,
    cells: Record<string, unknown>,
    ip: string,
    submitterUserId?: string,
  ) {
    await this.assertRateLimit(shareToken, ip);

    const form = await this.prisma.form.findUnique({
      where: { shareToken },
      include: { sheet: { include: { fields: true } } },
    });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    this.assertShareOpen(form);

    const configured = form.fields as unknown as FormFieldConfig[];
    const configuredIds = new Set(configured.map((field) => field.fieldId));
    const visible = configured.filter((config) =>
      isFormFieldVisible(config, cells),
    );
    const visibleIds = new Set(visible.map((config) => config.fieldId));
    const sheetFieldIds = new Set(
      form.sheet.fields.map((field) => field.id),
    );

    for (const key of Object.keys(cells)) {
      if (visibleIds.has(key)) continue;
      if (configuredIds.has(key)) continue; // hidden by display conditions
      if (sheetFieldIds.has(key)) {
        throw new BadRequestException(`字段未配置在表单中: ${key}`);
      }
      throw new BadRequestException(`未知字段: ${key}`);
    }

    for (const config of visible) {
      if (!config.required) continue;
      const raw = cells[config.fieldId];
      const empty =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        const meta = form.sheet.fields.find(
          (field) => field.id === config.fieldId,
        );
        throw new BadRequestException(
          `请填写「${meta?.name ?? '必填项'}」`,
        );
      }
    }

    const sanitized: Record<string, unknown> = {};
    for (const config of visible) {
      if (cells[config.fieldId] !== undefined) {
        sanitized[config.fieldId] = cells[config.fieldId];
      }
    }

    // Sheet everyone fieldRule: reject non-editable / exhausted submitOnce cells.
    await this.permissions.assertEveryoneSheetFieldWrites(
      form.sheetId,
      sanitized,
    );

    const submissionId = randomUUID();

    if (this.submitMode === 'queue') {
      await this.prisma.formSubmission.create({
        data: {
          id: submissionId,
          formId: form.id,
          status: 'queued',
          cells: sanitized as Prisma.InputJsonValue,
        },
      });
      try {
        const job = await this.queue?.add(
          'claim',
          { submissionId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 500 },
            removeOnComplete: 1000,
          },
        );
        this.metrics.increment('form_submit_total', {
          mode: 'queue',
          status: 'queued',
        });
        return {
          submissionId,
          recordId: null,
          status: 'queued',
          jobId: job?.id,
          pollUrl: `/public/forms/${form.shareToken}/submissions/${submissionId}`,
        };
      } catch (error) {
        const message = (error as Error).message;
        await this.prisma.formSubmission.update({
          where: { id: submissionId },
          data: { status: 'failed', error: '提交队列暂不可用' },
        });
        this.metrics.increment('form_submit_total', {
          mode: 'queue',
          status: 'failed',
        });
        this.logger.error(`enqueue submission failed: ${message}`);
        throw new ServiceUnavailableException('提交队列暂不可用，请稍后再试');
      }
    }

    try {
      const outcome = await this.runClaim(
        form,
        sanitized,
        submissionId,
        false,
        submitterUserId,
      );
      const html = this.successHtml(form, sanitized, outcome.stepOutputs);
      await this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'completed',
          resultHtml: html,
          stepOutputs: outcome.stepOutputs as Prisma.InputJsonValue,
        },
      });
      this.metrics.increment('form_submit_total', {
        mode: 'sync',
        status: 'success',
      });
      await this.notifyFormOwners(form, submissionId, outcome);
      return {
        submissionId,
        recordId: outcome.recordId,
        status: 'completed',
        success: { html },
        stepOutputs: outcome.stepOutputs,
      };
    } catch (error) {
      this.metrics.increment('form_submit_total', {
        mode: 'sync',
        status: 'failed',
      });
      throw error;
    }
  }

  /**
   * Worker entry point. Safe to retry: a completed submission is a no-op and
   * the claim transaction is atomic, so no code is ever consumed twice.
   */
  async processQueuedSubmission(submissionId: string): Promise<void> {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: { form: { include: { sheet: { include: { fields: true } } } } },
    });
    if (!submission || submission.status === 'completed') return;

    const form = submission.form;
    const sanitized = submission.cells as Record<string, unknown>;
    try {
      const outcome = await this.runClaim(form, sanitized, submissionId, true);
      const html = this.successHtml(form, sanitized, outcome.stepOutputs);
      await this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'completed',
          resultHtml: html,
          stepOutputs: outcome.stepOutputs as Prisma.InputJsonValue,
          error: null,
        },
      });
      this.metrics.increment('form_submit_total', {
        mode: 'queue',
        status: 'success',
      });
      await this.notifyFormOwners(form, submissionId, outcome);
    } catch (error) {
      const message =
        error instanceof HttpException
          ? error.message
          : (error as Error).message;
      await this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: { status: 'failed', error: message },
      });
      this.metrics.increment('form_submit_total', {
        mode: 'queue',
        status: 'failed',
      });
    }
  }

  async getSubmissionStatus(shareToken: string, submissionId: string) {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: { form: true },
    });
    if (!submission || submission.form.shareToken !== shareToken) {
      throw new NotFoundException('提交记录不存在');
    }
    return {
      submissionId: submission.id,
      recordId: submission.recordId,
      status: submission.status,
      success:
        submission.status === 'completed' && submission.resultHtml
          ? { html: submission.resultHtml }
          : undefined,
      stepOutputs: submission.stepOutputs,
      error: submission.error,
    };
  }

  private async runClaim(
    form: SubmissionForm,
    sanitized: Record<string, unknown>,
    submissionId: string,
    queued: boolean,
    submitterUserId?: string,
  ): Promise<{ recordId: string; stepOutputs: Record<string, string> }> {
    // Claim, form record, and submission commit or roll back together: a
    // submission either gets a serial and a record, or writes nothing at all.
    const committed = await this.prisma.$transaction(
      async (tx) => {
        if (form.rejectDuplicatePhone) {
          const uniqueField =
            (form.duplicateCheckFieldId
              ? form.sheet.fields.find(
                  (field) => field.id === form.duplicateCheckFieldId,
                )
              : null) ??
            form.sheet.fields.find(
              (field) =>
                field.type === 'phone' &&
                Object.prototype.hasOwnProperty.call(sanitized, field.id),
            );
          const uniqueValue = uniqueField
            ? String(sanitized[uniqueField.id] ?? '').trim()
            : '';
          if (uniqueField && uniqueValue) {
            // Serialize same-value submissions so the guard cannot race.
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${form.sheetId}:${uniqueField.id}:${uniqueValue}`}))`,
            );
            const existing = await tx.$queryRaw<Array<{ id: string }>>(
              Prisma.sql`SELECT id FROM "records" WHERE "sheet_id" = ${form.sheetId}::uuid AND cells->>${uniqueField.id} = ${uniqueValue} LIMIT 1`,
            );
            if (existing.length > 0) {
              const label = uniqueField.name.trim() || '该字段';
              throw new ConflictException(`该【${label}】不可重复提交`);
            }
          }
        }

        const strippedNumbers = await stripAutoNumberInputs(
          tx,
          form.sheetId,
          sanitized,
        );
        const stripped = await stripAiFieldInputs(
          tx,
          form.sheetId,
          strippedNumbers,
        );
        const withNumbers = await applyAutoNumbers(
          tx,
          form.sheetId,
          stripped,
        );
        const withAi = await applyAiFields(tx, form.sheetId, withNumbers);
        const record = await tx.recordRow.create({
          data: {
            sheetId: form.sheetId,
            cells: withAi as Prisma.InputJsonValue,
          },
        });

        if (queued) {
          await tx.formSubmission.update({
            where: { id: submissionId },
            data: { recordId: record.id, status: 'processing' },
          });
        } else {
          await tx.formSubmission.create({
            data: {
              id: submissionId,
              formId: form.id,
              recordId: record.id,
              status: 'processing',
              cells: sanitized as Prisma.InputJsonValue,
            },
          });
        }

        const formRuns = await this.automationRunner.triggerFormSubmitted(
          form.id,
          record.id,
          tx,
          `formSubmitted:${submissionId}`,
          submitterUserId,
        );
        // formSubmitted 真正生效（成功/等待续跑）时才跳过 recordCreated；
        // 仅 skipped 时回退到 recordCreated，避免领取类自动化被跳过却拦截提交
        const formTookEffect = formRuns.some(
          (run) => run.status === 'success' || run.status === 'waiting',
        );
        const createdRuns = formTookEffect
          ? []
          : await this.automationRunner.triggerRecordCreated(
              record.id,
              tx,
              `submission:${submissionId}`,
              submitterUserId,
            );
        const runs = [...formRuns, ...createdRuns];

        const failed = runs.find((run) => run.status === 'failed');
        if (failed) {
          throw new UnprocessableEntityException(
            `自动化执行失败：${failed.error ?? '未知错误'}`,
          );
        }
        // waiting = 延迟后续异步续跑，同步段已成功
        const anyOk = runs.some(
          (run) => run.status === 'success' || run.status === 'waiting',
        );
        const anySkipped = runs.some((run) => run.status === 'skipped');
        if (!anyOk && anySkipped) {
          throw new ConflictException('序列号已领取完毕，请稍后再试');
        }
        if (runs.length > 0 && !anyOk) {
          throw new ConflictException('序列号已领取完毕，请稍后再试');
        }

        const stepOutputs = Object.assign(
          {},
          ...runs.map((run) => run.stepOutputs),
        ) as Record<string, string>;

        const pendingDelays = runs
          .map((run) => run.pendingDelay)
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

        return { recordId: record.id, stepOutputs, pendingDelays };
      },
      { timeout: 30_000 },
    );

    for (const pending of committed.pendingDelays) {
      try {
        await this.automationRunner.schedulePendingDelay(pending);
      } catch (error) {
        // 延迟续跑失败不回滚已提交的领取
        this.logger.error(
          `form claim delay resume failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      recordId: committed.recordId,
      stepOutputs: committed.stepOutputs,
    };
  }

  /**
   * Notify workspace owners/admins when a public form submission completes.
   * Failures are logged only — they must never roll back a successful claim.
   */
  private async notifyFormOwners(
    form: SubmissionForm,
    submissionId: string,
    outcome: { recordId: string; stepOutputs: Record<string, string> },
  ): Promise<void> {
    try {
      const base = await this.prisma.base.findUnique({
        where: { id: form.baseId },
        select: { id: true, name: true, workspaceId: true },
      });
      if (!base) return;

      const recipients = await this.prisma.workspaceMember.findMany({
        where: {
          workspaceId: base.workspaceId,
          role: { in: ['owner', 'admin'] },
        },
        select: { userId: true },
      });
      if (recipients.length === 0) return;

      const serial =
        outcome.stepOutputs['序列号'] ??
        outcome.stepOutputs['serial'] ??
        outcome.stepOutputs['SN'];
      const title = `表单「${form.name}」有新提交`;
      const body = serial
        ? `已写入记录，序列号：${serial}`
        : `已写入记录 ${outcome.recordId.slice(0, 8)}…`;
      const data = {
        kind: 'form_submit',
        formId: form.id,
        formName: form.name,
        baseId: base.id,
        workspaceId: base.workspaceId,
        sheetId: form.sheetId,
        submissionId,
        recordId: outcome.recordId,
      } as unknown as Prisma.InputJsonValue;

      await this.prisma.notification.createMany({
        data: recipients.map((row) => ({
          userId: row.userId,
          title,
          body,
          data,
        })),
      });
      for (const row of recipients) {
        await this.live.emit({
          baseId: base.id,
          workspaceId: base.workspaceId,
          actorId: null,
          kind: 'notification.created',
          entityId: submissionId,
          userId: row.userId,
          meta: {
            kind: 'form_submit',
            formId: form.id,
            sheetId: form.sheetId,
            submissionId,
            recordId: outcome.recordId,
          },
        });
      }
      await this.live.emit({
        baseId: base.id,
        actorId: null,
        kind: 'sheet.rev_bumped',
        entityId: form.sheetId,
        meta: { reason: 'form_submit', recordId: outcome.recordId },
      });
    } catch (error) {
      this.logger.warn(
        `form submit notify failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private successHtml(
    form: SubmissionForm,
    sanitized: Record<string, unknown>,
    stepOutputs: Record<string, string>,
  ): string {
    // 产品：成功页正文 = 自动化「发送消息」插值后的内容（与站内信一致）
    const messageBody = stepOutputs['消息内容']?.trim();
    if (messageBody) {
      return escapeHtml(messageBody).replace(/\n/g, '<br />');
    }

    // 无发送消息步骤时回退到表单成功页模板 + 自动化扁平变量
    const formCellsByName: Record<string, unknown> = {};
    for (const field of form.sheet.fields) {
      if (Object.prototype.hasOwnProperty.call(sanitized, field.id)) {
        formCellsByName[field.name] = sanitized[field.id];
      }
    }
    const successValues = buildSuccessValues({
      formCells: formCellsByName,
      stepOutputs,
    });
    const rendered = renderSuccessTemplate(
      form.successTemplate || '提交成功',
      successValues,
    ).trim();
    // 空模板 / 仅空白时给明确成功态，避免公开页「点了提交没反应」
    return rendered || '<p>提交成功</p>';
  }

  async previewSuccess(
    formId: string,
    userId: string,
    input: PreviewSuccessDto,
  ) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.requireBaseEditor(form.baseId, userId);

    const values = buildSuccessValues({
      formCells: input.formCells,
      stepOutputs: input.stepOutputs,
    });
    return {
      html: renderSuccessTemplate(form.successTemplate, values),
      values,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.queueConnection?.quit();
    if (this.rateLimitRedis) {
      try {
        await this.rateLimitRedis.quit();
      } catch {
        this.rateLimitRedis.disconnect();
      }
    }
  }

  private async requireBaseEditor(baseId: string, userId: string) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) {
      throw new NotFoundException('Base 不存在');
    }
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );
  }

  private assertDisplayTriggers(
    field: Pick<FormFieldConfig, 'displayConditions' | 'displayRule'>,
    sheetFields: Array<{ id: string; type: string }>,
    sheetFieldIds: Set<string>,
  ): void {
    if (field.displayRule) {
      this.assertDisplayRuleShape(field.displayRule, 0);
    }
    for (const condition of walkDisplayConditionLeaves(field)) {
      if (!condition.fieldId) {
        throw new BadRequestException('显示条件未选择触发字段');
      }
      if (!sheetFieldIds.has(condition.fieldId)) {
        throw new BadRequestException('显示条件引用了不存在的字段');
      }
      const triggerField = sheetFields.find(
        (item) => item.id === condition.fieldId,
      );
      if (
        triggerField &&
        (triggerField.type === 'formula' || triggerField.type === 'lookup')
      ) {
        throw new BadRequestException('显示条件不支持公式或查找引用字段');
      }
    }
  }

  private assertDisplayRuleShape(
    rule: DisplayConditionRule,
    depth: number,
  ): void {
    if (depth > 3) {
      throw new BadRequestException('显示条件嵌套过深');
    }
    if (rule.conjunction !== 'and' && rule.conjunction !== 'or') {
      throw new BadRequestException('显示条件组合方式无效');
    }
    if (!Array.isArray(rule.conditions)) {
      throw new BadRequestException('显示条件格式无效');
    }
    if (rule.conditions.length > 20) {
      throw new BadRequestException('显示条件过多');
    }
    for (const node of rule.conditions) {
      if (isDisplayConditionRule(node)) {
        this.assertDisplayRuleShape(node, depth + 1);
      }
    }
  }

  private assertShareOpen(form: Form): void {
    const share = (form.share ?? {}) as ShareConfig;
    if (share.enabled === false) {
      throw new ForbiddenException('分享链接已关闭');
    }
    if (share.expiresAt) {
      const expiresAt = Date.parse(share.expiresAt);
      if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
        throw new ForbiddenException('分享链接已过期');
      }
    }
  }

  private async assertRateLimit(
    shareToken: string,
    ip: string,
  ): Promise<void> {
    const key = `${shareToken}:${ip}`;
    const now = Date.now();
    const windowMs = 60_000;

    if (this.rateLimitRedis) {
      try {
        const redisKey = `st:form:submit:${key}`;
        // Sliding window via sorted set
        const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
        const pipe = this.rateLimitRedis.multi();
        pipe.zremrangebyscore(redisKey, 0, now - windowMs);
        pipe.zadd(redisKey, now, member);
        pipe.zcard(redisKey);
        pipe.pexpire(redisKey, windowMs);
        const results = await pipe.exec();
        const count = Number(results?.[2]?.[1] ?? 0);
        if (count > this.submitLimit) {
          await this.rateLimitRedis.zrem(redisKey, member);
          throw new HttpException(
            '提交过于频繁，请稍后再试',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.warn(
          `form rate-limit Redis failed, memory fallback: ${String(error)}`,
        );
      }
    }

    const hits = (this.submitHits.get(key) ?? []).filter(
      (timestamp) => now - timestamp < windowMs,
    );

    if (hits.length >= this.submitLimit) {
      this.submitHits.set(key, hits);
      throw new HttpException(
        '提交过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.submitHits.set(key, hits);
  }

  private resolveDuplicateCheckFieldId(
    dto: { duplicateCheckFieldId?: string | null; rejectDuplicatePhone?: boolean },
    configured: Array<{ fieldId: string }>,
    sheetFields: Array<{ id: string; type: string }>,
    previous: string | null,
  ): string | null {
    const configuredIds = new Set(configured.map((item) => item.fieldId));
    const requested =
      dto.duplicateCheckFieldId === undefined
        ? previous
        : dto.duplicateCheckFieldId;
    if (requested) {
      if (!configuredIds.has(requested)) {
        throw new BadRequestException('去重字段须已加入表单');
      }
      if (!sheetFields.some((field) => field.id === requested)) {
        throw new BadRequestException('去重字段不在当前工作表中');
      }
      return requested;
    }
    const reject =
      dto.rejectDuplicatePhone ?? true;
    if (!reject) return null;
    const phoneOnForm = configured
      .map((item) => sheetFields.find((field) => field.id === item.fieldId))
      .find((field) => field?.type === 'phone');
    return phoneOnForm?.id ?? null;
  }

  private async toDto(form: Form) {
    const share = (form.share ?? {}) as ShareConfig;
    const qrUrl = `${this.publicBase}/fill/${form.shareToken}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
      margin: 1,
      width: 240,
    });

    return {
      id: form.id,
      baseId: form.baseId,
      sheetId: form.sheetId,
      name: form.name,
      coverUrl: form.coverUrl,
      fields: form.fields,
      share: {
        enabled: share.enabled !== false,
        audience: share.audience ?? 'anyone',
        expiresAt: share.expiresAt ?? null,
        token: form.shareToken,
        qrUrl,
        qrCodeDataUrl,
      },
      successPage: { templateHtml: form.successTemplate },
      rejectDuplicatePhone: form.rejectDuplicatePhone,
      duplicateCheckFieldId: form.duplicateCheckFieldId,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }
}
