import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  evaluateFilterGroup,
  type FilterGroup,
  type RecordTimerTrigger,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { AutomationRunnerService } from './automation-runner.service';

interface DueRow {
  id: string;
  cells: Record<string, unknown>;
}

/**
 * Polls WeCom-style「到达记录时间」triggers: when a date/datetime cell is due,
 * run the automation once per (automation, record, cell stamp).
 */
@Injectable()
export class RecordTimerService {
  private readonly logger = new Logger(RecordTimerService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
    private readonly quotas: QuotasService,
  ) {}

  async runDueTimers(limitPerAutomation = 20): Promise<
    Array<{ automationId: string; recordId: string; status: string }>
  > {
    if (this.ticking) return [];
    this.ticking = true;
    const results: Array<{
      automationId: string;
      recordId: string;
      status: string;
    }> = [];
    try {
      const automations = await this.prisma.automation.findMany({
        where: { enabled: true },
        include: { base: true },
        take: 100,
      });
      const now = Date.now();

      for (const automation of automations) {
        const trigger = automation.trigger as unknown as RecordTimerTrigger;
        if (trigger?.type !== 'recordTimer') continue;
        if (!trigger.sheetId || !trigger.fieldId) continue;

        const sheet = await this.prisma.sheet.findFirst({
          where: { id: trigger.sheetId, baseId: automation.baseId },
          include: { fields: true },
        });
        if (!sheet) continue;
        const field = sheet.fields.find((item) => item.id === trigger.fieldId);
        if (!field || field.type !== 'date') continue;

        const take = Math.min(Math.max(limitPerAutomation, 1), 50);
        const rows = await this.prisma.$queryRaw<DueRow[]>(Prisma.sql`
          SELECT id, cells
          FROM "records"
          WHERE "sheet_id" = ${trigger.sheetId}::uuid
            AND NULLIF(cells->>${trigger.fieldId}, '') IS NOT NULL
            AND (cells->>${trigger.fieldId}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND CASE
              WHEN length(cells->>${trigger.fieldId}) <= 10
                THEN (cells->>${trigger.fieldId})::date <= CURRENT_DATE
              ELSE (cells->>${trigger.fieldId})::timestamptz <= NOW()
            END
          ORDER BY cells->>${trigger.fieldId} ASC
          LIMIT ${take}
        `);

        for (const row of rows) {
          const cells = (row.cells ?? {}) as Record<string, unknown>;
          const stamp = String(cells[trigger.fieldId] ?? '').trim();
          if (!stamp) continue;
          const dueMs = Date.parse(stamp.length === 10 ? `${stamp}T00:00:00` : stamp);
          if (!Number.isFinite(dueMs) || dueMs > now) continue;

          if (trigger.filters) {
            const ok = evaluateFilterGroup(
              trigger.filters as FilterGroup,
              cells,
            );
            if (!ok) continue;
          }

          const idempotencyKey = `recordTimer:${automation.id}:${row.id}:${stamp}`;
          try {
            await this.quotas.assertAutomationRun(automation.base.workspaceId);
            const result = await this.runner.runAutomation(automation.id, {
              triggerRecordId: row.id,
              triggerCells: cells,
              idempotencyKey,
            });
            results.push({
              automationId: automation.id,
              recordId: row.id,
              status: result.status,
            });
          } catch (error) {
            this.logger.warn(
              `recordTimer ${automation.id} record ${row.id}: ${String(error)}`,
            );
          }
        }
      }
      return results;
    } finally {
      this.ticking = false;
    }
  }
}
