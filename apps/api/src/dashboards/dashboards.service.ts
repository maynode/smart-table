import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type { AggregateMode } from '../analytics/analytics.types';

const WIDGET_TYPES = [
  'bar',
  'horizontalBar',
  'line',
  'pie',
  'combo',
  'wordcloud',
  'metric',
  'table',
  'text',
] as const;

export interface WidgetConfig {
  dimensionFieldId?: string;
  metricFieldId?: string;
  aggregation?: AggregateMode;
  limit?: number;
  sortBy?: 'value' | 'label';
  sortOrder?: 'asc' | 'desc';
  themeColor?: string;
  showLegend?: boolean;
  showLabel?: boolean;
  legendPosition?: string;
  stackMode?: 'none' | 'stack' | 'percent';
  showXAxis?: boolean;
  showYAxis?: boolean;
  showGrid?: boolean;
  xAxisTitle?: string;
  yAxisTitle?: string;
  yMin?: number | null;
  yMax?: number | null;
  logScale?: boolean;
  textContent?: string;
}

@Injectable()
export class DashboardsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacesService: WorkspacesService,
    private readonly permissions: PermissionsService,
    private readonly analytics: AnalyticsService,
  ) {}

  async create(baseId: string, userId: string, name: string, kind = 'dashboard') {
    const base = await this.requireBase(baseId, userId, 'editor');
    if (!['dashboard', 'report'].includes(kind)) {
      throw new BadRequestException('仪表盘类型无效');
    }
    return this.prisma.dashboard.create({
      data: {
        baseId: base.id,
        name: name.trim(),
        kind,
        createdBy: userId,
      },
    });
  }

  async list(baseId: string, userId: string, kind?: string) {
    await this.requireBase(baseId, userId, 'viewer');
    return this.prisma.dashboard.findMany({
      where: { baseId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(dashboardId: string, userId: string) {
    const dashboard = await this.requireDashboard(dashboardId, userId);
    return {
      ...dashboard,
      widgets: dashboard.widgets.sort((a, b) => a.order - b.order),
    };
  }

  async addWidget(
    dashboardId: string,
    userId: string,
    dto: {
      type: string;
      title: string;
      sheetId?: string;
      config?: WidgetConfig;
      layout?: Record<string, unknown>;
    },
  ) {
    const dashboard = await this.requireDashboard(dashboardId, userId, 'editor');
    if (!(WIDGET_TYPES as readonly string[]).includes(dto.type)) {
      throw new BadRequestException('图表类型无效');
    }
    if (dto.type !== 'text' && !dto.sheetId) {
      throw new BadRequestException('请选择工作表');
    }
    if (dto.sheetId) {
      await this.assertSheetInBase(dto.sheetId, dashboard.baseId);
    }
    const count = await this.prisma.dashboardWidget.count({
      where: { dashboardId },
    });
    return this.prisma.dashboardWidget.create({
      data: {
        dashboardId,
        type: dto.type,
        title: dto.title.trim(),
        sheetId: dto.sheetId,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
        layout: (dto.layout ?? {}) as Prisma.InputJsonValue,
        order: count,
      },
    });
  }

  async updateWidget(
    dashboardId: string,
    widgetId: string,
    userId: string,
    dto: {
      title?: string;
      type?: string;
      sheetId?: string;
      config?: WidgetConfig;
      layout?: Record<string, unknown>;
      order?: number;
    },
  ) {
    const dashboard = await this.requireDashboard(dashboardId, userId, 'editor');
    const widget = await this.prisma.dashboardWidget.findUnique({
      where: { id: widgetId },
    });
    if (!widget || widget.dashboardId !== dashboard.id) {
      throw new NotFoundException('图表不存在');
    }
    if (
      dto.type !== undefined &&
      !(WIDGET_TYPES as readonly string[]).includes(dto.type)
    ) {
      throw new BadRequestException('图表类型无效');
    }
    if (dto.sheetId) await this.assertSheetInBase(dto.sheetId, dashboard.baseId);
    return this.prisma.dashboardWidget.update({
      where: { id: widgetId },
      data: {
        ...(dto.title === undefined ? {} : { title: dto.title.trim() }),
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.sheetId === undefined ? {} : { sheetId: dto.sheetId }),
        ...(dto.config === undefined
          ? {}
          : { config: dto.config as Prisma.InputJsonValue }),
        ...(dto.layout === undefined
          ? {}
          : { layout: dto.layout as Prisma.InputJsonValue }),
        ...(dto.order === undefined ? {} : { order: dto.order }),
      },
    });
  }

  async deleteWidget(dashboardId: string, widgetId: string, userId: string) {
    const dashboard = await this.requireDashboard(dashboardId, userId, 'editor');
    await this.prisma.dashboardWidget.deleteMany({
      where: { id: widgetId, dashboardId: dashboard.id },
    });
    return { id: widgetId, deleted: true };
  }

  async queryWidget(dashboardId: string, widgetId: string, userId: string) {
    const dashboard = await this.requireDashboard(dashboardId, userId);
    const widget = dashboard.widgets.find((item) => item.id === widgetId);
    if (!widget) throw new NotFoundException('图表不存在');
    return this.computeWidget(widget, userId);
  }

  async data(dashboardId: string, userId: string) {
    const dashboard = await this.requireDashboard(dashboardId, userId);
    const widgets = [];
    for (const widget of dashboard.widgets.sort((a, b) => a.order - b.order)) {
      widgets.push(await this.computeWidget(widget, userId));
    }
    return {
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        kind: dashboard.kind,
        layout: dashboard.layout,
      },
      widgets,
      driver: this.analytics.driver,
    };
  }

  async createSchedule(
    dashboardId: string,
    userId: string,
    dto: { cron: string; channel?: string },
  ) {
    const dashboard = await this.requireDashboard(dashboardId, userId, 'editor');
    const cron = (dto.cron ?? '').trim();
    if (cron.split(/\s+/).length !== 5) {
      throw new BadRequestException('Cron 表达式需为 5 段');
    }
    return this.prisma.dashboardSchedule.create({
      data: {
        dashboardId: dashboard.id,
        cron,
        channel: dto.channel ?? 'notification',
        createdBy: userId,
        nextRunAt: this.nextRun(cron),
      },
    });
  }

  async listSchedules(dashboardId: string, userId: string) {
    await this.requireDashboard(dashboardId, userId);
    return this.prisma.dashboardSchedule.findMany({
      where: { dashboardId },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 10 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async runSchedule(
    dashboardId: string,
    scheduleId: string,
    userId: string,
    options: { system?: boolean } = {},
  ) {
    const dashboard = await this.requireDashboard(
      dashboardId,
      options.system ? undefined : userId,
    );
    const schedule = await this.prisma.dashboardSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule || schedule.dashboardId !== dashboard.id) {
      throw new NotFoundException('定时推送不存在');
    }

    const data = await this.data(dashboard.id, userId);
    const title = `仪表盘推送：${dashboard.name}`;
    const body = `共 ${data.widgets.length} 个图表，分析引擎 ${data.driver}。`;
    const notification = await this.prisma.notification.create({
      data: {
        userId: schedule.createdBy ?? userId,
        title,
        body,
        data: {
          dashboardId: dashboard.id,
          scheduleId: schedule.id,
          widgets: data.widgets.length,
        } as Prisma.InputJsonValue,
      },
    });
    const run = await this.prisma.dashboardScheduleRun.create({
      data: {
        scheduleId: schedule.id,
        status: 'success',
        message: `已通过 ${schedule.channel} 推送`,
        payload: {
          notificationId: notification.id,
          widgets: data.widgets,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.dashboardSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: this.nextRun(schedule.cron),
      },
    });
    return { ...run, notificationId: notification.id };
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runDueSchedules()
        .then((count) => {
          if (count) this.logger.log(`delivered ${count} dashboard schedules`);
        })
        .catch((error: unknown) => {
          this.logger.warn(`dashboard scheduler failed: ${String(error)}`);
        });
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runDueSchedules() {
    const due = await this.prisma.dashboardSchedule.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: new Date() },
        createdBy: { not: null },
      },
      take: 10,
    });
    for (const schedule of due) {
      await this.runSchedule(
        schedule.dashboardId,
        schedule.id,
        schedule.createdBy!,
        { system: true },
      );
    }
    return due.length;
  }

  private async computeWidget(
    widget: {
      id: string;
      type: string;
      title: string;
      sheetId: string | null;
      config: unknown;
      layout: unknown;
    },
    userId: string,
  ) {
    const config = (widget.config ?? {}) as WidgetConfig;
    if (
      widget.type === 'text' ||
      !widget.sheetId ||
      !config.dimensionFieldId
    ) {
      return {
        id: widget.id,
        type: widget.type,
        title: widget.title,
        labels: [],
        values: [],
        config,
        layout: widget.layout ?? {},
        driver: this.analytics.driver,
      };
    }
    await this.permissions.assertCan(
      'sheet',
      widget.sheetId,
      userId,
      'read',
    );
    const rows = await this.analytics.query({
      sheetId: widget.sheetId,
      dimensionFieldId: config.dimensionFieldId,
      metricFieldId: config.metricFieldId,
      aggregation: config.aggregation ?? 'count',
      limit: config.limit,
      sortBy: config.sortBy,
      sortOrder: config.sortOrder,
    });
    return {
      id: widget.id,
      type: widget.type,
      title: widget.title,
      labels: rows.map((row) => row.label),
      values: rows.map((row) => row.value),
      rows,
      config,
      layout: widget.layout ?? {},
      driver: this.analytics.driver,
    };
  }

  private async requireBase(
    baseId: string,
    userId: string,
    minimum: 'viewer' | 'editor' = 'viewer',
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.workspacesService.requireMember(
      base.workspaceId,
      userId,
      minimum,
    );
    return base;
  }

  private async requireDashboard(
    dashboardId: string,
    userId: string | undefined,
    minimum: 'viewer' | 'editor' = 'viewer',
  ) {
    const dashboard = await this.prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: { widgets: true },
    });
    if (!dashboard) throw new NotFoundException('仪表盘不存在');
    if (userId) {
      const base = await this.prisma.base.findUnique({
        where: { id: dashboard.baseId },
      });
      if (!base) throw new NotFoundException('Base 不存在');
      await this.workspacesService.requireMember(
        base.workspaceId,
        userId,
        minimum,
      );
    }
    return dashboard;
  }

  private async assertSheetInBase(sheetId: string, baseId: string) {
    const sheet = await this.prisma.sheet.findUnique({ where: { id: sheetId } });
    if (!sheet || sheet.baseId !== baseId) {
      throw new BadRequestException('图表工作表不属于当前 Base');
    }
  }

  private nextRun(cron: string): Date {
    const parts = cron.split(/\s+/);
    const minute = Number(parts[0]);
    const now = new Date();
    if (Number.isFinite(minute) && minute >= 0 && minute < 60) {
      const next = new Date(now.getTime() + 60 * 60 * 1000);
      next.setMinutes(minute, 0, 0);
      return next;
    }
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
