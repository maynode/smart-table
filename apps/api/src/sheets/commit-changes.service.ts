import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COMMIT_ERROR,
  type CommitChangesResponse,
  type MutationResult,
  type MutationResultOk,
  type SheetMutation,
} from 'shared';
import { FormsService } from '../forms/forms.service';
import { PrismaService } from '../prisma/prisma.service';
import { applyAiFields } from './ai-field';
import type { CommitChangesDto } from './dto/commit-changes.dto';
import {
  SheetCommitQueue,
  type SheetCommitJob,
} from './sheet-commit-queue.service';
import { SheetsService } from './sheets.service';

const MAX_BATCH_CHARS = 1_500_000;

@Injectable()
export class CommitChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly forms: FormsService,
    @Inject(forwardRef(() => SheetCommitQueue))
    private readonly commitQueue: SheetCommitQueue,
  ) {}

  async commit(
    sheetId: string,
    userId: string,
    dto: CommitChangesDto,
    clientIp = '0.0.0.0',
    expectedSheetRev?: number,
    options?: { skipAccessCheck?: boolean; rebase?: boolean },
  ): Promise<CommitChangesResponse> {
    const rawSize = JSON.stringify(dto).length;
    if (rawSize > MAX_BATCH_CHARS) {
      throw new BadRequestException({
        code: COMMIT_ERROR.OVERSIZE,
        message: '提交包过大',
      });
    }

    if (!options?.skipAccessCheck) {
      await this.sheets.assertSheetAccess(sheetId, userId, 'editor');
    }

    return this.commitQueue.enqueue({
      sheetId,
      userId,
      dto,
      clientIp,
      expectedSheetRev,
      rebase: options?.rebase === true,
    });
  }

  /** Worker / memory actor entry — access already checked by `commit`. */
  executeCommitJob(job: SheetCommitJob): Promise<CommitChangesResponse> {
    return this.commitSerialized(
      job.sheetId,
      job.userId,
      job.dto,
      job.clientIp,
      job.expectedSheetRev,
      job.rebase === true,
    );
  }

  private async commitSerialized(
    sheetId: string,
    userId: string,
    dto: CommitChangesDto,
    clientIp: string,
    expectedSheetRev?: number,
    rebase = false,
  ): Promise<CommitChangesResponse> {
    const run = async (): Promise<CommitChangesResponse> => {
      // Actor 内串行：以 DB 当前 sheetRev 为准。rebase 时容忍客户端旧 baseRev
      //（多人排队时几乎人人都会落后），避免「先写记录再 CAS 失败」制造脏版本。
      const sheet = await this.prisma.sheet.findUnique({
        where: { id: sheetId },
        select: { sheetRev: true },
      });
      if (!sheet) {
        throw new NotFoundException('工作表不存在');
      }
      let baseRev = sheet.sheetRev;
      if (expectedSheetRev !== undefined) {
        if (expectedSheetRev > baseRev) {
          throw new ConflictException('COMMIT_BASE_VER_TOO_LOW');
        }
        if (expectedSheetRev < baseRev && !rebase) {
          throw new ConflictException('COMMIT_BASE_VER_TOO_LOW');
        }
        // rebase || equal → 用当前 baseRev 往前 bump
      }

      const mutations = dto.mutations as unknown as SheetMutation[];
      const onlySetRecords =
        mutations.length > 0 &&
        mutations.every((m) => m.type === 'setRecord');

      if (onlySetRecords && rebase) {
        return this.fastRebaseSetRecords({
          sheetId,
          userId,
          dto,
          mutations,
          baseRev,
        });
      }

      const idMaps = {
        records: new Map<string, string>(),
        fields: new Map<string, string>(),
      };
      const results: MutationResult[] = [];

      for (const mutation of mutations) {
        results.push(
          await this.applyOne(sheetId, userId, mutation, idMaps, clientIp),
        );
      }

      const allOk = results.every(
        (r) => r.status === 'ok' || r.status === 'duplicate',
      );
      let sheetRev: number | undefined;
      if (allOk && mutations.length > 0) {
        const newRev = baseRev + 1;
        const bumped = await this.prisma.sheet.updateMany({
          where: { id: sheetId, sheetRev: baseRev },
          data: { sheetRev: newRev },
        });
        if (bumped.count === 0) {
          throw new ConflictException('COMMIT_BASE_VER_TOO_LOW');
        }
        await this.prisma.sheetChangeset.create({
          data: {
            sheetId,
            rev: newRev,
            authorId: userId,
            commitId: dto.clientBatchId,
            mutations: dto.mutations as object[],
          },
        });
        sheetRev = newRev;
      }

      return { clientBatchId: dto.clientBatchId, results, sheetRev };
    };

    return run();
  }

  /**
   * Collab 热路径：仅 setRecord + Actor 已串行。
   * 单事务内：读/改记录 → bump sheet_rev → changeset → commitOp。
   */
  private async fastRebaseSetRecords(params: {
    sheetId: string;
    userId: string;
    dto: CommitChangesDto;
    mutations: SheetMutation[];
    baseRev: number;
  }): Promise<CommitChangesResponse> {
    const { sheetId, userId, dto, mutations, baseRev } = params;
    const newRev = baseRev + 1;

    return this.prisma.$transaction(async (tx) => {
      const results: MutationResult[] = [];
      for (const mutation of mutations) {
        if (mutation.type !== 'setRecord') {
          throw new BadRequestException('fast path 仅支持 setRecord');
        }
        const record = await tx.recordRow.findUnique({
          where: { id: mutation.recordId },
        });
        if (!record || record.sheetId !== sheetId) {
          results.push({
            clientOpId: mutation.clientOpId,
            status: 'error',
            code: COMMIT_ERROR.NOT_FOUND,
            message: '记录不存在',
          });
          continue;
        }
        const currentCells = (record.cells ?? {}) as Record<string, unknown>;
        let merged: Record<string, unknown> = {
          ...currentCells,
          ...mutation.cells,
        };
        // 与 HTTP updateRecord 对齐：源字段变更时重算 AI 填值列
        merged = await applyAiFields(tx, sheetId, merged, currentCells);
        const expectedVersion = mutation.baseVersion;
        if (expectedVersion !== undefined) {
          const updated = await tx.recordRow.updateMany({
            where: { id: record.id, version: expectedVersion },
            data: {
              cells: merged as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
          if (updated.count === 0) {
            results.push({
              clientOpId: mutation.clientOpId,
              status: 'error',
              code: COMMIT_ERROR.VERSION_CONFLICT,
              message: '记录已被他人修改，请刷新后重试',
            });
            continue;
          }
        } else {
          await tx.recordRow.update({
            where: { id: record.id },
            data: {
              cells: merged as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
        }
        const ok: MutationResultOk = {
          clientOpId: mutation.clientOpId,
          status: 'ok',
          record: {
            id: record.id,
            cells: merged,
            version:
              expectedVersion !== undefined
                ? expectedVersion + 1
                : record.version + 1,
          },
        };
        try {
          await tx.commitOp.create({
            data: {
              clientOpId: mutation.clientOpId,
              sheetId,
              userId,
              opType: mutation.type,
              result: ok as object,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const existing = await tx.commitOp.findUnique({
              where: { clientOpId: mutation.clientOpId },
            });
            if (existing) {
              results.push({
                ...(existing.result as unknown as MutationResultOk),
                status: 'duplicate',
              });
              continue;
            }
          }
          throw error;
        }
        results.push(ok);
      }

      const allOk = results.every(
        (r) => r.status === 'ok' || r.status === 'duplicate',
      );
      if (!allOk || mutations.length === 0) {
        // 不 bump：整批回滚记录写？此处已部分写入。失败则抛错回滚事务。
        throw new ConflictException('COMMIT_MUTATION_FAILED');
      }

      const bumped = await tx.sheet.updateMany({
        where: { id: sheetId, sheetRev: baseRev },
        data: { sheetRev: newRev },
      });
      if (bumped.count === 0) {
        throw new ConflictException('COMMIT_BASE_VER_TOO_LOW');
      }
      await tx.sheetChangeset.create({
        data: {
          sheetId,
          rev: newRev,
          authorId: userId,
          commitId: dto.clientBatchId,
          mutations: dto.mutations as object[],
        },
      });

      return {
        clientBatchId: dto.clientBatchId,
        results,
        sheetRev: newRev,
      };
    });
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
    try {
      const ok = await this.dispatch(
        sheetId,
        userId,
        mutation,
        idMaps,
        clientIp,
      );
      try {
        await this.prisma.commitOp.create({
          data: {
            clientOpId: mutation.clientOpId,
            sheetId,
            userId,
            opType: mutation.type,
            result: ok as object,
          },
        });
      } catch (error) {
        // 幂等：先写后撞唯一键 → 回读（省掉每次成功路径上的 findUnique）。
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const existing = await this.prisma.commitOp.findUnique({
            where: { clientOpId: mutation.clientOpId },
          });
          if (existing) {
            const prior = existing.result as unknown as MutationResultOk;
            return { ...prior, status: 'duplicate' };
          }
        }
        throw error;
      }
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
          { skipSideEffects: true },
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
