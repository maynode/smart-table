import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import type { SheetMutation } from 'shared';

@Controller()
@UseGuards(JwtAuthGuard)
export class CollabController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
  ) {}

  @Get('sheets/:sheetId/changes')
  async listChanges(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Query('fromRev') fromRevRaw?: string,
  ) {
    await this.sheets.assertSheetAccess(sheetId, user.sub, 'viewer');
    const fromRev = Math.max(0, Number(fromRevRaw ?? 0) || 0);
    const sheet = await this.prisma.sheet.findUnique({ where: { id: sheetId } });
    const rows = await this.prisma.sheetChangeset.findMany({
      where: { sheetId, rev: { gt: fromRev } },
      orderBy: { rev: 'asc' },
      take: 500,
    });
    return {
      sheetRev: sheet?.sheetRev ?? 0,
      fromRev,
      changesets: rows.map((r) => ({
        rev: r.rev,
        authorId: r.authorId,
        commitId: r.commitId,
        mutations: r.mutations as unknown as SheetMutation[],
        createdAt: r.createdAt,
      })),
    };
  }
}
