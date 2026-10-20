import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Form } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import {
  buildSuccessValues,
  isFormFieldVisible,
  renderSuccessTemplate,
  type FormFieldConfig,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type {
  PreviewSuccessDto,
  UpsertFormDto,
} from './dto/form-config.dto';

interface ShareConfig {
  enabled?: boolean;
  audience?: 'anyone' | 'workspace';
  expiresAt?: string | null;
}

@Injectable()
export class FormsService {
  private readonly publicBase: string;
  private readonly submitLimit: number;
  private readonly submitHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.publicBase = (
      this.config.get<string>('PUBLIC_FORM_BASE_URL') ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    this.submitLimit = Number(
      this.config.get<string>('PUBLIC_SUBMIT_RATE_LIMIT') ?? 30,
    );
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
    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) {
      throw new NotFoundException('表单不存在');
    }
    await this.requireBaseEditor(form.baseId, userId);

    const coverUrl = await this.storage.saveCover(buffer, mimetype);
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
    const values: Record<string, unknown> = {};
    const fieldById = new Map(
      form.sheet.fields.map((field) => [field.id, field]),
    );

    const fields = configured
      .filter((config) => isFormFieldVisible(config, values))
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

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.recordRow.create({
        data: {
          sheetId: form.sheetId,
          cells: sanitized as Prisma.InputJsonValue,
        },
      });
      const submission = await tx.formSubmission.create({
        data: {
          formId: form.id,
          recordId: record.id,
          status: 'completed',
          cells: sanitized as Prisma.InputJsonValue,
        },
      });
      return { record, submission };
    });

    const formCellsByName: Record<string, unknown> = {};
    for (const field of form.sheet.fields) {
      if (Object.prototype.hasOwnProperty.call(sanitized, field.id)) {
        formCellsByName[field.name] = sanitized[field.id];
      }
    }
    const successValues = buildSuccessValues({ formCells: formCellsByName });
    const html = renderSuccessTemplate(
      form.successTemplate || '提交成功',
      successValues,
    );

    return {
      submissionId: result.submission.id,
      recordId: result.record.id,
      status: 'completed',
      success: { html },
    };
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
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }
}
