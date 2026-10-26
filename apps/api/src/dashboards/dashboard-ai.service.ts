import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SheetDigestService } from '../ai/sheet-digest.service';
import { PrismaService } from '../prisma/prisma.service';
import { newMessageId } from '../analysis-reports/analysis-steps';
import {
  chatDashboardAgentReply,
  validateDashboardActions,
  type DashboardActionResult,
  type DashboardAiAction,
  type DashboardWidgetCatalogItem,
} from './dashboard-ai.adapter';
import { DashboardsService } from './dashboards.service';

export type DashboardAiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'text';
  createdAt: string;
  clientMessageId?: string;
  applied?: DashboardActionResult[];
};

@Injectable()
export class DashboardAiService {
  private readonly logger = new Logger(DashboardAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboards: DashboardsService,
    private readonly digests: SheetDigestService,
  ) {}

  async getSession(dashboardId: string, userId: string) {
    await this.dashboards.assertAccess(dashboardId, userId, 'viewer');
    const session = await this.ensureSession(dashboardId, userId);
    return this.toDto(session, dashboardId);
  }

  async clearMessages(dashboardId: string, userId: string) {
    await this.dashboards.assertAccess(dashboardId, userId, 'editor');
    const session = await this.ensureSession(dashboardId, userId);
    const welcome = this.welcomeMessage();
    const updated = await this.prisma.dashboardAiSession.update({
      where: { id: session.id },
      data: {
        status: 'idle',
        error: null,
        messages: [welcome] as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toDto(updated, dashboardId);
  }

  async chat(
    dashboardId: string,
    userId: string,
    text: string,
    clientMessageId?: string,
  ) {
    const content = text?.trim() ?? '';
    if (!content) throw new BadRequestException('请输入消息');

    const dashboard = await this.dashboards.assertAccess(
      dashboardId,
      userId,
      'editor',
    );

    let session = await this.ensureSession(dashboardId, userId);
    const messages = [
      ...(session.messages as unknown as DashboardAiMessage[]),
    ];

    if (clientMessageId) {
      const priorUser = messages.find(
        (m) => m.role === 'user' && m.clientMessageId === clientMessageId,
      );
      if (priorUser) {
        const idx = messages.indexOf(priorUser);
        const assistant = messages
          .slice(idx + 1)
          .find((m) => m.role === 'assistant');
        const widgets = (
          await this.dashboards.get(dashboardId, userId)
        ).widgets;
        return {
          ...this.toDto(session, dashboardId),
          applied: assistant?.applied ?? [],
          widgets,
          idempotent: true,
        };
      }
    }

    if (session.status === 'thinking') {
      throw new BadRequestException('正在回复中，请稍候');
    }

    const userMessage: DashboardAiMessage = {
      id: newMessageId(),
      role: 'user',
      content,
      kind: 'text',
      createdAt: new Date().toISOString(),
      ...(clientMessageId ? { clientMessageId } : {}),
    };
    messages.push(userMessage);

    session = await this.prisma.dashboardAiSession.update({
      where: { id: session.id },
      data: {
        status: 'thinking',
        error: null,
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const base = await this.prisma.base.findUnique({
        where: { id: dashboard.baseId },
      });
      const sheets = await this.digests.listReadableSheets(
        dashboard.baseId,
        userId,
      );
      const digests = sheets.length
        ? await this.digests.buildDigests(
            sheets.map((s) => s.id),
            userId,
          )
        : [];
      const catalog: DashboardWidgetCatalogItem[] = (
        dashboard.widgets ?? []
      ).map((w) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        sheetId: w.sheetId,
        config: (w.config ?? {}) as Record<string, unknown>,
        layout: (w.layout ?? {}) as Record<string, unknown>,
        order: w.order,
      }));

      const conversation = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { reply, actions: rawActions } = await chatDashboardAgentReply({
        baseName: base?.name ?? '智能表格',
        digests,
        widgets: catalog,
        conversation,
        userText: content,
      });

      const { actions, errors } = validateDashboardActions(
        rawActions as unknown[],
        {
          digests,
          widgets: catalog,
          userText: content,
        },
      );

      let applied: DashboardActionResult[] = [];
      let finalReply = reply;
      if (errors.length && !actions.length) {
        finalReply = `${reply}\n（未能执行改图：${errors.join('；')}）`.trim();
      } else if (actions.length) {
        try {
          applied = await this.dashboards.applyAiActions(
            dashboardId,
            userId,
            actions.map(toApplyDto),
          );
          if (errors.length) {
            finalReply =
              `${reply}\n（部分动作未执行：${errors.join('；')}）`.trim();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : '应用图表变更失败';
          this.logger.warn(`dashboard ai apply failed: ${message}`);
          finalReply = `${reply}\n（应用失败已回滚：${message}）`.trim();
          applied = [];
        }
      }

      const assistantMessage: DashboardAiMessage = {
        id: newMessageId(),
        role: 'assistant',
        content: finalReply,
        kind: 'text',
        createdAt: new Date().toISOString(),
        ...(applied.length ? { applied } : {}),
      };
      messages.push(assistantMessage);

      session = await this.prisma.dashboardAiSession.update({
        where: { id: session.id },
        data: {
          status: 'idle',
          error: null,
          messages: messages as unknown as Prisma.InputJsonValue,
        },
      });

      const refreshed = await this.dashboards.get(dashboardId, userId);
      return {
        ...this.toDto(session, dashboardId),
        applied,
        widgets: refreshed.widgets,
        idempotent: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '仪表盘助手回复失败';
      messages.push({
        id: newMessageId(),
        role: 'assistant',
        content: `抱歉，处理失败：${message}`,
        kind: 'text',
        createdAt: new Date().toISOString(),
      });
      session = await this.prisma.dashboardAiSession.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          error: message,
          messages: messages as unknown as Prisma.InputJsonValue,
        },
      });
      const refreshed = await this.dashboards.get(dashboardId, userId);
      return {
        ...this.toDto(session, dashboardId),
        applied: [],
        widgets: refreshed.widgets,
        idempotent: false,
      };
    }
  }

  private welcomeMessage(): DashboardAiMessage {
    return {
      id: newMessageId(),
      role: 'assistant',
      content:
        '你好，我是仪表盘助手。可以说「加一张柱状图」「删除某某图」或「放大最后一张」，也可以问数据概况。',
      kind: 'text',
      createdAt: new Date().toISOString(),
    };
  }

  private async ensureSession(dashboardId: string, userId: string) {
    const existing = await this.prisma.dashboardAiSession.findUnique({
      where: { dashboardId },
    });
    if (existing) return existing;
    return this.prisma.dashboardAiSession.create({
      data: {
        dashboardId,
        createdBy: userId,
        status: 'idle',
        messages: [this.welcomeMessage()] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private toDto(
    session: {
      id: string;
      dashboardId: string;
      status: string;
      messages: unknown;
      error: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    dashboardId: string,
  ) {
    return {
      id: session.id,
      dashboardId: session.dashboardId || dashboardId,
      status: session.status,
      messages: session.messages as DashboardAiMessage[],
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}

function toApplyDto(action: DashboardAiAction) {
  if (action.op === 'add_widget') {
    return {
      op: 'add_widget' as const,
      type: action.type,
      title: action.title,
      sheetId: action.sheetId,
      config: action.config,
      layout: action.layout,
    };
  }
  if (action.op === 'update_widget') {
    return {
      op: 'update_widget' as const,
      widgetId: action.widgetId,
      title: action.title,
      type: action.type,
      sheetId: action.sheetId,
      config: action.config,
      layout: action.layout,
      order: action.order,
    };
  }
  return {
    op: 'delete_widget' as const,
    widgetId: action.widgetId,
  };
}
