import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  formatExportDisplay,
  parseGridContract,
  type AiComponentOptions,
} from 'shared';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

type SheetField = {
  id: string;
  name: string;
  type: string;
  options: unknown;
  order: number;
  required: boolean;
};

@Injectable()
export class ExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly live: LiveBusService,
  ) {}

  async exportSheet(
    sheetId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const sheet = await this.requireSheet(sheetId, userId, 'editor');
    const fields = sheet.fields as SheetField[];
    const records = await this.prisma.recordRow.findMany({
      where: { sheetId },
      orderBy: { id: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('数据');
    worksheet.columns = fields.map((field) => ({
      header: field.name,
      key: field.id,
      width: 20,
    }));
    worksheet.getRow(1).font = { bold: true };

    for (const record of records) {
      const cells = (record.cells ?? {}) as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      for (const field of fields) {
        row[field.id] = this.toExcelValue(field, cells[field.id]);
      }
      worksheet.addRow(row);
    }

    // Phone/text identifiers must stay text; otherwise Excel strips leading 0.
    fields.forEach((field, index) => {
      if (
        ['phone', 'text', 'longText', 'email', 'url', 'id'].includes(field.type)
      ) {
        worksheet.getColumn(index + 1).numFmt = '@';
      }
    });

    const written = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(written as ArrayBuffer),
      filename: `${sheet.name}.xlsx`,
    };
  }

  async importSheet(sheetId: string, userId: string, buffer: Buffer) {
    const sheet = await this.requireSheet(sheetId, userId, 'editor');
    const fields = sheet.fields as SheetField[];

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('无法解析 Excel 文件');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Excel 中没有工作表');
    }

    const header = worksheet.getRow(1);
    const fieldByHeader = new Map<string, SheetField>();
    const columnByField = new Map<string, number>();
    header.eachCell((cell, col) => {
      const name = this.rawText(cell.value).trim();
      const field = fields.find((item) => item.name === name);
      if (field) {
        fieldByHeader.set(name, field);
        columnByField.set(field.id, col);
      }
    });
    if (fieldByHeader.size === 0) {
      throw new BadRequestException('表头与工作表字段不匹配');
    }

    const statusField = fields.find(
      (field) => field.name === '状态' || field.name === '领取状态',
    );

    const errors: Array<{ row: number; message: string }> = [];
    const rows: Array<{ cells: Record<string, unknown>; claimStatus: string | null }> =
      [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const cells: Record<string, unknown> = {};
      let hasValue = false;
      let rowFailed = false;

      for (const [fieldId, column] of columnByField.entries()) {
        const field = fields.find((item) => item.id === fieldId);
        if (!field) continue;
        const raw = row.getCell(column).value;
        if (this.isBlank(raw)) continue;
        const converted = this.toStoredValue(field, raw);
        if (converted.error) {
          errors.push({ row: rowNumber, message: `${field.name}: ${converted.error}` });
          rowFailed = true;
          continue;
        }
        cells[fieldId] = converted.value;
        hasValue = true;
      }

      if (!hasValue) continue;

      for (const field of fields) {
        if (
          field.required &&
          (cells[field.id] === undefined || cells[field.id] === '')
        ) {
          errors.push({ row: rowNumber, message: `${field.name} 为必填` });
          rowFailed = true;
        }
      }

      if (rowFailed) continue;

      rows.push({
        cells,
        claimStatus: statusField
          ? this.claimStatusFor(cells[statusField.id], statusField.options)
          : null,
      });
    }

    let imported = 0;
    const chunkSize = 500;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const result = await this.prisma.recordRow.createMany({
        data: chunk.map((row) => ({
          sheetId,
          cells: row.cells as Prisma.InputJsonValue,
          claimStatus: row.claimStatus,
        })),
      });
      imported += result.count;
    }

    if (imported > 0) {
      await this.live.emit({
        baseId: sheet.baseId,
        actorId: userId,
        kind: 'sheet.rev_bumped',
        entityId: sheetId,
        meta: {
          sheetRev: sheet.sheetRev,
          reason: 'excel_import',
          imported,
        },
      });
    }

    return {
      imported,
      skipped: errors.length,
      errors: errors.slice(0, 100),
    };
  }

  private async requireSheet(
    sheetId: string,
    userId: string,
    role: 'editor',
  ) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: {
        base: true,
        fields: { orderBy: { order: 'asc' } },
      },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    await this.workspacesService.requireMember(
      sheet.base.workspaceId,
      userId,
      role,
    );
    return sheet;
  }

  private toExcelValue(field: SheetField, value: unknown): unknown {
    if (value === undefined || value === null || value === '') return null;

    if (field.type === 'aiComponent') {
      const opts =
        field.options && typeof field.options === 'object'
          ? ((field.options as { aiComponent?: AiComponentOptions })
              .aiComponent ?? {})
          : {};
      const contract = parseGridContract(opts.gridContract);
      if (contract) return formatExportDisplay(value, contract);
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return null;
        }
      }
      return value;
    }

    if (field.type === 'select') {
      return this.choiceName(field.options, value);
    }
    if (field.type === 'multiSelect') {
      const list = Array.isArray(value) ? value : [value];
      return list.map((item) => this.choiceName(field.options, item)).join(', ');
    }
    if (field.type === 'checkbox') {
      return value === true || value === 'true' || value === '是' || value === 1
        ? '是'
        : '否';
    }
    if (
      ['number', 'percent', 'currency', 'progress', 'rating', 'duration'].includes(
        field.type,
      )
    ) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    if (field.type === 'date') {
      return String(value);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  }

  private toStoredValue(
    field: SheetField,
    raw: unknown,
  ): { value?: unknown; error?: string } {
    if (field.type === 'select') {
      const text = this.rawText(raw).trim();
      const choices = this.choices(field.options);
      const choice = choices.find(
        (item) => item.name === text || item.id === text,
      );
      if (!choice) return { error: `选项不存在：${text}` };
      return { value: choice.id };
    }

    if (field.type === 'multiSelect') {
      const text = this.rawText(raw).trim();
      const choices = this.choices(field.options);
      const values = text
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const choice = choices.find(
            (candidate) => candidate.name === item || candidate.id === item,
          );
          return choice?.id ?? item;
        });
      return { value: values };
    }

    if (field.type === 'checkbox') {
      const text = this.rawText(raw).trim().toLowerCase();
      return {
        value: ['是', 'true', '1', 'yes', 'y', '✓'].includes(text),
      };
    }

    if (
      ['number', 'percent', 'currency', 'progress', 'rating', 'duration'].includes(
        field.type,
      )
    ) {
      const text = this.rawText(raw).replace(/[¥$,%\s]/g, '');
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return { error: `不是有效数字：${text}` };
      return { value: parsed };
    }

    if (field.type === 'date') {
      if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) return { error: '日期无效' };
        return { value: raw.toISOString().slice(0, 10) };
      }
      if (typeof raw === 'number') {
        const date = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
        return { value: date.toISOString().slice(0, 10) };
      }
      return { value: this.rawText(raw).trim() };
    }

    if (field.type === 'phone') {
      return { value: this.rawText(raw).replace(/\.0$/, '').trim() };
    }

    return { value: this.rawText(raw) };
  }

  private claimStatusFor(value: unknown, options: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const choice = this.choices(options).find(
      (item) => item.id === raw || item.name === raw,
    );
    const normalized = String(choice?.name ?? raw);
    if (['unclaimed', '未领', '未领取', '待领取'].includes(normalized)) {
      return 'unclaimed';
    }
    if (['claimed', '已领', '已领取'].includes(normalized)) {
      return 'claimed';
    }
    return null;
  }

  private choices(
    options: unknown,
  ): Array<{ id: string; name: string }> {
    const list = (
      options as { choices?: Array<{ id?: unknown; name?: unknown }> } | null
    )?.choices;
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && item.id !== undefined)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
      }));
  }

  private choiceName(options: unknown, value: unknown): string {
    const raw = String(value ?? '');
    const choice = this.choices(options).find(
      (item) => item.id === raw || item.name === raw,
    );
    return choice?.name ?? raw;
  }

  private rawText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const cell = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: string }>;
      };
      if (cell.text !== undefined) return String(cell.text);
      if (cell.result !== undefined) return String(cell.result);
      if (Array.isArray(cell.richText)) {
        return cell.richText.map((part) => part.text ?? '').join('');
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  private isBlank(value: unknown): boolean {
    return (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '')
    );
  }
}
