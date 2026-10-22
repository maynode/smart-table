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
  isFormFieldVisible,
  renderSuccessTemplate,
  type FormFieldConfig,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { createRedisConnection } from '../queue/redis-connection';
import { AutomationRunnerService } from '../automations/automation-runner.service';
import { MetricsService } from '../metrics/metrics.service';
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
    private readonly storage: StorageService,
    private readonly automationRunner: AutomationRunnerService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly quotas: QuotasService,
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

    if (this.submitMode === 'queue') {
      const url = this.config.get<string>(
        'REDIS_URL',
        'redis://127.0.0.1:6379',
      );
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
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      'editor',
    );

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
      if (seen.has(field.fieldId)) {
        throw new BadRequestException('表单字段重复');
      }
      seen.add(field.fieldId);
      for (const condition of field.displayConditions ?? []) {
        if (!sheetFieldIds.has(condition.fieldId)) {
          throw new BadRequestException('显示条件引用了不存在的字段');
        }
        // WeCom: 不支持将公式及查找引用字段设置为条件
        const triggerField = sheet.fields.find(
          (item) => item.id === condition.fieldId,
        );
        if (
          triggerField &&
          (triggerField.type === 'formula' || triggerField.type === 'lookup')
        ) {
          throw new BadRequestException(
            '显示条件不支持公式或查找引用字段',
          );
        }
      }
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
        },
      });
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
      },
    });
    return this.toDto(created);
  }

  async getForOwner(formId: string, userId: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.requireBaseEditor(form.baseId, userId);
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
    return Promise.all(forms.map((form) => this.toDto(form)));
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
    await this.requireBaseEditor(form.baseId, userId);

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
    return { coverUrl: updated.coverUrl };
  }

  async getPublic(shareToken: string) {
    const form = await this.prisma.form.findUnique({
      where: { shareToken },
      include: { sheet: { include: { fields: true } } },
    });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    this.assertShareOpen(form);

    const configured = form.fields as unknown as FormFieldConfig[];
    const fieldById = new Map(
      form.sheet.fields.map((field) => [field.id, field]),
    );

    // Return every configured field: the public client re-evaluates display
    // conditions as the respondent fills the form. Filtering here against empty
    // values would permanently hide conditional fields.
    const fields = configured
      .flatMap((config) => {
        const field = fieldById.get(config.fieldId);
        if (!field) return [];
        return [
          {
            fieldId: field.id,
            name: field.name,
            type: field.type,
            options: field.options,
            required: Boolean(config.required),
            displayConditions: config.displayConditions ?? [],
          },
        ];
      });

    return {
      id: form.id,
      name: form.name,
      coverUrl: form.coverUrl,
      qrUrl: `${this.publicBase}/fill/${form.shareToken}`,
      fields,
    };
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
    this.assertRateLimit(shareToken, ip);

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
    return this.prisma.$transaction(
      async (tx) => {
        if (form.rejectDuplicatePhone) {
          const phoneField = form.sheet.fields.find(
            (field) =>
              field.type === 'phone' &&
              Object.prototype.hasOwnProperty.call(sanitized, field.id),
          );
          const phone = phoneField
            ? String(sanitized[phoneField.id] ?? '').trim()
            : '';
          if (phoneField && phone) {
            // Serialize same-phone submissions so the guard cannot race.
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${form.sheetId}:${phone}`}))`,
            );
            const existing = await tx.$queryRaw<Array<{ id: string }>>(
              Prisma.sql`SELECT id FROM "records" WHERE "sheet_id" = ${form.sheetId}::uuid AND cells->>${phoneField.id} = ${phone} LIMIT 1`,
            );
            if (existing.length > 0) {
              throw new ConflictException('该手机号不可重复领取');
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

        const runs = await this.automationRunner.triggerRecordCreated(
          record.id,
          tx,
          `submission:${submissionId}`,
          submitterUserId,
        );

        const blocked = runs.find(
          (run) => run.status === 'failed' || run.status === 'skipped',
        );
        if (blocked) {
          if (blocked.status === 'skipped') {
            throw new ConflictException('序列号已领取完毕，请稍后再试');
          }
          throw new UnprocessableEntityException(
            `自动化执行失败：${blocked.error ?? '未知错误'}`,
          );
        }

        const stepOutputs = Object.assign(
          {},
          ...runs.map((run) => run.stepOutputs),
        ) as Record<string, string>;

        return { recordId: record.id, stepOutputs };
      },
      { timeout: 30_000 },
    );
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
    return renderSuccessTemplate(
      form.successTemplate || '提交成功',
      successValues,
    );
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

  private assertRateLimit(shareToken: string, ip: string): void {
    const key = `${shareToken}:${ip}`;
    const now = Date.now();
    const windowMs = 60_000;
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
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }
}
