import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SharingService } from '../sharing/sharing.service';
import { DashboardsService } from '../dashboards/dashboards.service';

type PublicSheetSnapshot = {
  id: string;
  name: string;
  kind: 'sheet' | 'form';
  fields: Array<{
    id: string;
    name: string;
    type: string;
    options: unknown;
    required: boolean;
  }>;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
};

type ScopePayload = {
  sheetIds?: string[];
  formSheetIds?: string[];
  dashboardIds?: string[];
  analysisReportIds?: string[];
};

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((id): id is string => typeof id === 'string' && Boolean(id)),
    ),
  ];
}

@Injectable()
export class PublicViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly sharing: SharingService,
    private readonly dashboards: DashboardsService,
  ) {}

  async scopeOptions(sheetId: string, userId: string) {
    const sheet = await this.assertEditor(sheetId, userId);
    const baseId = sheet.baseId;

    const [sheets, forms, dashboards, reports] = await Promise.all([
      this.prisma.sheet.findMany({
        where: { baseId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.form.findMany({
        where: { baseId },
        select: { id: true, name: true, sheetId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dashboard.findMany({
        where: { baseId, kind: 'dashboard' },
        select: {
          id: true,
          name: true,
          _count: { select: { widgets: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.analysisReport.findMany({
        where: { baseId },
        select: {
          id: true,
          name: true,
          status: true,
          reportMarkdown: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const formSheetIds = new Set(forms.map((form) => form.sheetId));
    const recordCounts = await this.prisma.recordRow.groupBy({
      by: ['sheetId'],
      where: { sheetId: { in: sheets.map((item) => item.id) } },
      _count: { _all: true },
    });
    const countBySheet = new Map(
      recordCounts.map((row) => [row.sheetId, row._count._all]),
    );

    const dataSheets = sheets
      .filter((item) => !formSheetIds.has(item.id))
      .map((item) => {
        const recordCount = countBySheet.get(item.id) ?? 0;
        return {
          id: item.id,
          name: item.name,
          hasData: recordCount > 0,
          recordCount,
        };
      });

    const formSheets = forms.map((form) => {
      const recordCount = countBySheet.get(form.sheetId) ?? 0;
      return {
        id: form.sheetId,
        formId: form.id,
        name: form.name,
        hasData: recordCount > 0,
        recordCount,
      };
    });

    return {
      sheets: dataSheets,
      formSheets,
      dashboards: dashboards.map((item) => ({
        id: item.id,
        name: item.name,
        hasData: item._count.widgets > 0,
        widgetCount: item._count.widgets,
      })),
      analysisReports: reports.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        hasData:
          item.status === 'ready' && Boolean(item.reportMarkdown?.trim()),
      })),
    };
  }

  async create(sheetId: string, userId: string, body: ScopePayload & {
    name?: string;
    password?: string;
    expiresAt?: string | null;
  }) {
    const sheet = await this.assertEditor(sheetId, userId);
    const password = (body.password ?? '').trim();
    if (password && password.length < 4) {
      throw new BadRequestException('访问密码至少 4 位');
    }
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('有效期时间无效');
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('有效期必须晚于当前时间');
      }
    }

    const scope = await this.resolveScope(sheet.baseId, sheetId, body);
    const created = await this.prisma.publicView.create({
      data: {
        sheetId,
        sheetIds: scope.sheetIds,
        formSheetIds: scope.formSheetIds,
        dashboardIds: scope.dashboardIds,
        analysisReportIds: scope.analysisReportIds,
        name: (body.name ?? sheet.name).trim() || sheet.name,
        token: randomBytes(18).toString('base64url'),
        passwordHash: password ? await hash(password) : null,
        expiresAt,
        createdBy: userId,
      },
    });
    return this.present(created);
  }

  async list(sheetId: string, userId: string) {
    await this.assertEditor(sheetId, userId);
    const views = await this.prisma.publicView.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'desc' },
    });
    return views.map((view) => this.present(view));
  }

  async remove(viewId: string, userId: string) {
    const view = await this.prisma.publicView.findUnique({
      where: { id: viewId },
    });
    if (!view) throw new NotFoundException('公开视图不存在');
    await this.assertEditor(view.sheetId, userId);
    await this.prisma.publicView.delete({ where: { id: viewId } });
    return { id: viewId, revoked: true };
  }

  async getPublic(token: string, password?: string) {
    const view = await this.requireView(token);
    if (view.passwordHash) {
      if (!password) {
        throw new UnauthorizedException('该公开视图需要访问密码');
      }
      const ok = await verify(view.passwordHash, password).catch(() => false);
      if (!ok) throw new ForbiddenException('访问密码错误');
    }
    return this.readData(view.id);
  }

  private async resolveScope(
    baseId: string,
    hostSheetId: string,
    body: ScopePayload,
  ): Promise<{
    sheetIds: string[];
    formSheetIds: string[];
    dashboardIds: string[];
    analysisReportIds: string[];
  }> {
    const scopeSpecified =
      body.sheetIds !== undefined ||
      body.formSheetIds !== undefined ||
      body.dashboardIds !== undefined ||
      body.analysisReportIds !== undefined;

    if (!scopeSpecified) {
      return {
        sheetIds: [hostSheetId],
        formSheetIds: [],
        dashboardIds: [],
        analysisReportIds: [],
      };
    }

    const options = await this.loadScopeUniverse(baseId);
    const sheetIds = asIdList(body.sheetIds);
    const formSheetIds = asIdList(body.formSheetIds);
    const dashboardIds = asIdList(body.dashboardIds);
    const analysisReportIds = asIdList(body.analysisReportIds);

    for (const id of sheetIds) {
      if (!options.sheetIds.has(id)) {
        throw new BadRequestException('公开范围只能选择本 Base 内有数据的工作表');
      }
    }
    for (const id of formSheetIds) {
      if (!options.formSheetIds.has(id)) {
        throw new BadRequestException(
          '公开范围只能选择本 Base 内有数据的表单收集结果',
        );
      }
    }
    for (const id of dashboardIds) {
      if (!options.dashboardIds.has(id)) {
        throw new BadRequestException(
          '公开范围只能选择本 Base 内有组件的仪表盘',
        );
      }
    }
    for (const id of analysisReportIds) {
      if (!options.analysisReportIds.has(id)) {
        throw new BadRequestException(
          '公开范围只能选择本 Base 内已生成的分析报告',
        );
      }
    }

    if (
      !sheetIds.length &&
      !formSheetIds.length &&
      !dashboardIds.length &&
      !analysisReportIds.length
    ) {
      throw new BadRequestException('请至少选择一项有数据的公开内容');
    }

    return { sheetIds, formSheetIds, dashboardIds, analysisReportIds };
  }

  private async loadScopeUniverse(baseId: string) {
    const [sheets, forms, dashboards, reports] = await Promise.all([
      this.prisma.sheet.findMany({
        where: { baseId },
        select: { id: true },
      }),
      this.prisma.form.findMany({
        where: { baseId },
        select: { sheetId: true },
      }),
      this.prisma.dashboard.findMany({
        where: { baseId, kind: 'dashboard' },
        select: { id: true, _count: { select: { widgets: true } } },
      }),
      this.prisma.analysisReport.findMany({
        where: { baseId, status: 'ready' },
        select: { id: true, reportMarkdown: true },
      }),
    ]);
    const formSheetIds = new Set(forms.map((form) => form.sheetId));
    const counts = await this.prisma.recordRow.groupBy({
      by: ['sheetId'],
      where: { sheetId: { in: sheets.map((s) => s.id) } },
      _count: { _all: true },
    });
    const withRecords = new Set(
      counts.filter((row) => row._count._all > 0).map((row) => row.sheetId),
    );

    return {
      sheetIds: new Set(
        sheets
          .filter((s) => !formSheetIds.has(s.id) && withRecords.has(s.id))
          .map((s) => s.id),
      ),
      formSheetIds: new Set(
        [...formSheetIds].filter((id) => withRecords.has(id)),
      ),
      dashboardIds: new Set(
        dashboards
          .filter((item) => item._count.widgets > 0)
          .map((item) => item.id),
      ),
      analysisReportIds: new Set(
        reports
          .filter((item) => Boolean(item.reportMarkdown?.trim()))
          .map((item) => item.id),
      ),
    };
  }

  private scopeOf(view: {
    sheetId: string;
    sheetIds?: unknown;
    formSheetIds?: unknown;
    dashboardIds?: unknown;
    analysisReportIds?: unknown;
  }) {
    const sheetIds = asIdList(view.sheetIds);
    const formSheetIds = asIdList(view.formSheetIds);
    const dashboardIds = asIdList(view.dashboardIds);
    const analysisReportIds = asIdList(view.analysisReportIds);
    if (
      !sheetIds.length &&
      !formSheetIds.length &&
      !dashboardIds.length &&
      !analysisReportIds.length
    ) {
      return {
        sheetIds: [view.sheetId],
        formSheetIds: [],
        dashboardIds: [],
        analysisReportIds: [],
      };
    }
    return { sheetIds, formSheetIds, dashboardIds, analysisReportIds };
  }

  private async readSheetSnapshot(
    sheetId: string,
    kind: 'sheet' | 'form',
    displayName?: string,
  ): Promise<PublicSheetSnapshot | null> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
    });
    if (!sheet) return null;
    const fields = await this.prisma.field.findMany({
      where: { sheetId, hidden: false },
      orderBy: { order: 'asc' },
    });
    const visibleIds = new Set(fields.map((field) => field.id));
    const records = await this.prisma.recordRow.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      id: sheet.id,
      name: displayName?.trim() || sheet.name,
      kind,
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options,
        required: field.required,
      })),
      records: records.map((record) => {
        const cells: Record<string, unknown> = {};
        for (const [fieldId, value] of Object.entries(
          (record.cells ?? {}) as Record<string, unknown>,
        )) {
          if (visibleIds.has(fieldId)) cells[fieldId] = value;
        }
        return { id: record.id, cells };
      }),
    };
  }

  private async readData(viewId: string) {
    const view = await this.prisma.publicView.findUniqueOrThrow({
      where: { id: viewId },
      include: { sheet: true },
    });
    const scope = this.scopeOf(view);

    const formNameBySheet = new Map<string, string>();
    if (scope.formSheetIds.length) {
      const forms = await this.prisma.form.findMany({
        where: { sheetId: { in: scope.formSheetIds } },
        select: { sheetId: true, name: true },
      });
      for (const form of forms) formNameBySheet.set(form.sheetId, form.name);
    }

    const sheets: PublicSheetSnapshot[] = [];
    for (const id of scope.sheetIds) {
      const snap = await this.readSheetSnapshot(id, 'sheet');
      if (snap) sheets.push(snap);
    }

    const formSheets: PublicSheetSnapshot[] = [];
    for (const id of scope.formSheetIds) {
      const snap = await this.readSheetSnapshot(
        id,
        'form',
        formNameBySheet.get(id),
      );
      if (snap) formSheets.push(snap);
    }

    const dashboards = [];
    for (const id of scope.dashboardIds) {
      const snap = await this.dashboards.publicSnapshot(id);
      if (snap) dashboards.push(snap);
    }

    const analysisReports = [];
    if (scope.analysisReportIds.length) {
      const reports = await this.prisma.analysisReport.findMany({
        where: {
          id: { in: scope.analysisReportIds },
          status: 'ready',
        },
      });
      const order = new Map(
        scope.analysisReportIds.map((id, index) => [id, index]),
      );
      reports.sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
      for (const report of reports) {
        if (!report.reportMarkdown?.trim()) continue;
        analysisReports.push({
          id: report.id,
          name: report.name,
          reportMarkdown: report.reportMarkdown,
        });
      }
    }

    const primary =
      sheets[0] ??
      formSheets[0] ??
      ({
        id: view.sheet.id,
        name: view.sheet.name,
        kind: 'sheet' as const,
        fields: [],
        records: [],
      });

    return {
      readonly: true as const,
      name: view.name,
      sheet: { id: primary.id, name: primary.name },
      sheets,
      formSheets,
      dashboards,
      analysisReports,
      fields: primary.fields,
      records: primary.records,
      expiresAt: view.expiresAt,
    };
  }

  private async requireView(token: string) {
    const view = await this.prisma.publicView.findUnique({
      where: { token },
    });
    if (!view || !view.enabled) {
      throw new NotFoundException('公开视图不存在或已关闭');
    }
    if (view.expiresAt && view.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('公开视图已过期');
    }
    return view;
  }

  private async assertEditor(sheetId: string, userId: string) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: true },
    });
    if (!sheet) throw new NotFoundException('工作表不存在');
    try {
      await this.workspaces.requireMember(
        sheet.base.workspaceId,
        userId,
        'editor',
      );
    } catch (error) {
      await this.sharing.assertAccess('sheet', sheetId, userId, 'editor');
    }
    return sheet;
  }

  private present(view: {
    id: string;
    sheetId: string;
    sheetIds?: unknown;
    formSheetIds?: unknown;
    dashboardIds?: unknown;
    analysisReportIds?: unknown;
    name: string;
    token: string;
    passwordHash: string | null;
    expiresAt: Date | null;
    enabled: boolean;
    createdAt: Date;
  }) {
    const base = (
      process.env.PUBLIC_FORM_BASE_URL ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    const scope = this.scopeOf(view);
    return {
      id: view.id,
      sheetId: view.sheetId,
      ...scope,
      name: view.name,
      token: view.token,
      passwordRequired: Boolean(view.passwordHash),
      expiresAt: view.expiresAt,
      enabled: view.enabled,
      createdAt: view.createdAt,
      url: `${base}/view/${view.token}`,
    };
  }
}
