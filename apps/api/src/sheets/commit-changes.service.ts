import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COMMIT_ERROR,
  type CommitChangesResponse,
  type MutationResult,
  type MutationResultOk,
  type SheetMutation,
} from 'shared';
import { FormsService } from '../forms/forms.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CommitChangesDto } from './dto/commit-changes.dto';
import { SheetsService } from './sheets.service';

const MAX_BATCH_CHARS = 1_500_000;

@Injectable()
export class CommitChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly forms: FormsService,
  ) {}

  async commit(
    sheetId: string,
    userId: string,
    dto: CommitChangesDto,
    clientIp = '0.0.0.0',
  ): Promise<CommitChangesResponse> {
    const rawSize = JSON.stringify(dto).length;
    if (rawSize > MAX_BATCH_CHARS) {
      throw new BadRequestException({
        code: COMMIT_ERROR.OVERSIZE,
        message: '提交包过大',
      });
    }

    await this.sheets.assertSheetAccess(sheetId, userId, 'editor');

    const idMaps = {
      records: new Map<string, string>(),
      fields: new Map<string, string>(),
    };
    const results: MutationResult[] = [];

    for (const raw of dto.mutations) {
      const mutation = raw as unknown as SheetMutation;
      results.push(
        await this.applyOne(sheetId, userId, mutation, idMaps, clientIp),
      );
    }

    return { clientBatchId: dto.clientBatchId, results };
  }

  private async applyOne(
    sheetId: string,
    userId: string,
    mutation: SheetMutation,
    idMaps: {
      records: Map<string, string>;
      fields: Map<string, string>;
    },
    clientIp: string,
  ): Promise<MutationResult> {
    const existing = await this.prisma.commitOp.findUnique({
      where: { clientOpId: mutation.clientOpId },
    });
    if (existing) {
      const prior = existing.result as unknown as MutationResultOk;
      return { ...prior, status: 'duplicate' };
    }

    try {
      const ok = await this.dispatch(
        sheetId,
        userId,
        mutation,
        idMaps,
        clientIp,
      );
      await this.prisma.commitOp.create({
        data: {
          clientOpId: mutation.clientOpId,
          sheetId,
          userId,
          opType: mutation.type,
          result: ok as object,
        },
      });
      return ok;
    } catch (error) {
      return this.toError(mutation.clientOpId, error);
    }
  }

  private async dispatch(
    sheetId: string,
    userId: string,
    mutation: SheetMutation,
    idMaps: {
      records: Map<string, string>;
      fields: Map<string, string>;
    },
    clientIp: string,
  ): Promise<MutationResultOk> {
    switch (mutation.type) {
      case 'setRecord': {
        const recordId =
          idMaps.records.get(mutation.recordId) ?? mutation.recordId;
        const updated = await this.sheets.updateRecord(
          recordId,
          userId,
          mutation.cells,
          mutation.baseVersion,
        );
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          record: {
            id: updated.id,
            cells: (updated.cells ?? {}) as Record<string, unknown>,
            version: updated.version,
          },
        };
      }
      case 'createRecord': {
        const created = await this.sheets.createRecord(
          sheetId,
          userId,
          mutation.cells ?? {},
        );
        idMaps.records.set(mutation.clientRecordId, created.id);
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          record: {
            id: created.id,
            cells: (created.cells ?? {}) as Record<string, unknown>,
            version: created.version,
          },
          recordIdMap: { [mutation.clientRecordId]: created.id },
        };
      }
      case 'insertRecords': {
        const recordIdMap: Record<string, string> = {};
        let last = null as Awaited<
          ReturnType<SheetsService['createRecord']>
        > | null;
        for (const row of mutation.records) {
          const created = await this.sheets.createRecord(
            sheetId,
            userId,
            row.cells ?? {},
          );
          idMaps.records.set(row.clientRecordId, created.id);
          recordIdMap[row.clientRecordId] = created.id;
          last = created;
        }
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          recordIdMap,
          record: last
            ? {
                id: last.id,
                cells: (last.cells ?? {}) as Record<string, unknown>,
                version: last.version,
              }
            : undefined,
        };
      }
      case 'deleteRecord': {
        const recordId =
          idMaps.records.get(mutation.recordId) ?? mutation.recordId;
        await this.sheets.deleteRecord(recordId, userId);
        return { clientOpId: mutation.clientOpId, status: 'ok' };
      }
      case 'createField': {
        const field = await this.sheets.createField(sheetId, userId, {
          name: mutation.name,
          type: mutation.fieldType as never,
          options: mutation.options ?? undefined,
          required: mutation.required,
        });
        idMaps.fields.set(mutation.clientFieldId, field.id);
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          field: {
            id: field.id,
            name: field.name,
            type: field.type,
            options: field.options,
            order: field.order,
            required: field.required,
            hidden: field.hidden,
          },
          fieldIdMap: { [mutation.clientFieldId]: field.id },
        };
      }
      case 'updateField': {
        const fieldId =
          idMaps.fields.get(mutation.fieldId) ?? mutation.fieldId;
        const field = await this.sheets.updateField(fieldId, userId, {
          name: mutation.name,
          options: mutation.options ?? undefined,
          required: mutation.required,
          hidden: mutation.hidden,
        });
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          field: {
            id: field.id,
            name: field.name,
            type: field.type,
            options: field.options,
            order: field.order,
            required: field.required,
            hidden: field.hidden,
          },
        };
      }
      case 'deleteField': {
        const fieldId =
          idMaps.fields.get(mutation.fieldId) ?? mutation.fieldId;
        await this.sheets.deleteField(fieldId, userId);
        return { clientOpId: mutation.clientOpId, status: 'ok' };
      }
      case 'createAttachment': {
        const recordId =
          idMaps.records.get(mutation.recordId) ?? mutation.recordId;
        const record = await this.prisma.recordRow.findUnique({
          where: { id: recordId },
        });
        if (!record || record.sheetId !== sheetId) {
          throw new NotFoundException('记录不存在');
        }
        const cells = {
          ...((record.cells ?? {}) as Record<string, unknown>),
        };
        const prev = cells[mutation.fieldId];
        const entry = {
          url: mutation.url,
          name: mutation.fileName,
          mimetype: mutation.contentType,
          size: mutation.size ?? 0,
        };
        const next = Array.isArray(prev) ? [...prev, entry] : [entry];
        cells[mutation.fieldId] = next;
        const updated = await this.sheets.updateRecord(
          recordId,
          userId,
          { [mutation.fieldId]: next },
          record.version,
        );
        return {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          record: {
            id: updated.id,
            cells: (updated.cells ?? {}) as Record<string, unknown>,
            version: updated.version,
          },
          attachment: { url: mutation.url, fileName: mutation.fileName },
        };
      }
      case 'publicFormSubmit': {
        const idem = mutation.idempotencyKey;
        if (!idem || !mutation.shareToken) {
          throw new BadRequestException('缺少 shareToken 或 idempotencyKey');
        }
        const prior = await this.prisma.formSubmitIdempotency.findUnique({
          where: { idempotencyKey: idem },
        });
        if (prior) {
          const cached = prior.result as unknown as MutationResultOk;
          return { ...cached, clientOpId: mutation.clientOpId, status: 'ok' };
        }
        const submission = await this.forms.submit(
          mutation.shareToken,
          mutation.cells,
          clientIp,
          userId,
        );
        const submissionId = String(
          (submission as { submissionId?: string }).submissionId ?? '',
        );
        const resultHtml =
          (submission as { success?: { html?: string } }).success?.html ?? null;
        const ok: MutationResultOk = {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          submission: {
            id: submissionId,
            recordId:
              (submission as { recordId?: string | null }).recordId ?? null,
            resultHtml,
          },
        };
        const form = await this.prisma.form.findUnique({
          where: { shareToken: mutation.shareToken },
        });
        await this.prisma.formSubmitIdempotency.create({
          data: {
            idempotencyKey: idem,
            formId: form?.id ?? sheetId,
            submissionId: submissionId || null,
            result: ok as object,
          },
        });
        return ok;
      }
      default:
        throw new BadRequestException('未知 mutation 类型');
    }
  }

  private toError(clientOpId: string, error: unknown): MutationResult {
    if (error instanceof ConflictException) {
      return {
        clientOpId,
        status: 'error',
        code: COMMIT_ERROR.VERSION_CONFLICT,
        message: this.messageOf(error) || '记录版本冲突',
      };
    }
    if (error instanceof ForbiddenException) {
      return {
        clientOpId,
        status: 'error',
        code: COMMIT_ERROR.FORBIDDEN,
        message: this.messageOf(error) || '没有权限',
      };
    }
    if (error instanceof NotFoundException) {
      return {
        clientOpId,
        status: 'error',
        code: COMMIT_ERROR.NOT_FOUND,
        message: this.messageOf(error) || '资源不存在',
      };
    }
    if (error instanceof BadRequestException) {
      return {
        clientOpId,
        status: 'error',
        code: COMMIT_ERROR.INVALID,
        message: this.messageOf(error) || '提交无效',
      };
    }
    return {
      clientOpId,
      status: 'error',
      code: COMMIT_ERROR.FAILED,
      message:
        error instanceof Error ? error.message : '提交失败',
    };
  }

  private messageOf(error: {
    getResponse?: () => string | object;
    message?: string;
  }): string {
    const res = error.getResponse?.();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      const m = (res as { message: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.map(String).join('；');
    }
    return error.message ?? '';
  }
}
