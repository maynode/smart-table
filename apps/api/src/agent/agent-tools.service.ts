import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  createAgentToolRegistry,
  type AgentToolRegistry,
  type ToolActor,
  type ToolDefinition,
  type ToolResult,
} from 'agent-tools';
import type { SheetMutation, ViewQuery } from 'shared';
import { ActivityLogService } from '../activity/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { BasesService } from '../bases/bases.service';
import { SheetsService } from '../sheets/sheets.service';
import { CommitChangesService } from '../sheets/commit-changes.service';
import { ViewsService } from '../views/views.service';
import { FormsService } from '../forms/forms.service';
import { AutomationsService } from '../automations/automations.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { PermissionsService } from '../permissions/permissions.service';
import { TemplatesService } from '../templates/templates.service';
import { CommentsService } from '../comments/comments.service';
import { PublicViewsService } from '../public-views/public-views.service';
import { AnalysisReportsService } from '../analysis-reports/analysis-reports.service';
import { QuotasService } from '../quotas/quotas.service';
import { AdminUsersService } from '../admin-users/admin-users.service';
import { SheetDigestService } from '../ai/sheet-digest.service';
import { LiveBusService } from '../live/live-bus.service';
import {
  arrArg,
  fail,
  newClientOpId,
  numArg,
  objArg,
  ok,
  strArg,
} from './agent-args';

@Injectable()
export class AgentToolsService implements OnModuleInit {
  readonly registry: AgentToolRegistry = createAgentToolRegistry();

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly workspaces: WorkspacesService,
    private readonly bases: BasesService,
    private readonly sheets: SheetsService,
    private readonly commits: CommitChangesService,
    private readonly views: ViewsService,
    private readonly forms: FormsService,
    private readonly automations: AutomationsService,
    private readonly dashboards: DashboardsService,
    private readonly permissions: PermissionsService,
    private readonly templates: TemplatesService,
    private readonly comments: CommentsService,
    private readonly publicViews: PublicViewsService,
    private readonly analysis: AnalysisReportsService,
    private readonly quotas: QuotasService,
    private readonly adminUsers: AdminUsersService,
    private readonly digests: SheetDigestService,
    private readonly live: LiveBusService,
  ) {}

  onModuleInit(): void {
    this.registry.registerAll(this.buildDefs());
  }

  listFor(actor: ToolActor) {
    return this.registry.list(actor);
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    actor: ToolActor,
  ): Promise<ToolResult> {
    const result = await this.registry.invoke(name, args, actor);
    void this.activity.record({
      actorId: actor.userId,
      actorAccount: actor.account,
      action: `agent.tool.${name}`,
      op: result.ok ? 'update' : 'other',
      summary: result.ok
        ? `Agent 调用 ${name}`
        : `Agent 调用 ${name} 失败: ${result.error ?? ''}`,
      method: 'TOOL',
      path: `/agent/tools/${name}`,
      resourceType: 'agent_tool',
      resourceId: name,
      source: 'agent',
      metadata: {
        ok: result.ok,
        code: result.code,
        argKeys: Object.keys(args ?? {}),
      },
    });
    return result;
  }

  private wrap(
    run: (args: Record<string, unknown>, actor: ToolActor) => Promise<unknown>,
  ): (args: Record<string, unknown>, actor: ToolActor) => Promise<ToolResult> {
    return async (args, actor) => {
      try {
        return ok(await run(args, actor));
      } catch (error) {
        return fail(error);
      }
    };
  }

  private buildDefs(): ToolDefinition[] {
    const w = this.wrap.bind(this);
    return [
      // ---- nav ----
      {
        name: 'list_workspaces',
        description: '列出当前用户可见的工作区',
        group: 'nav',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        handler: w(async (_a, actor) => this.workspaces.listMine(actor.userId)),
      },
      {
        name: 'list_bases',
        description: '列出工作区下的知识库/Base',
        group: 'nav',
        inputSchema: {
          type: 'object',
          properties: {
            workspaceId: { type: 'string', description: '工作区 ID' },
          },
          required: ['workspaceId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.bases.list(strArg(args, 'workspaceId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'get_base',
        description: '获取 Base 详情',
        group: 'nav',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.bases.getDetail(strArg(args, 'baseId', { required: true }), actor.userId),
        ),
      },

      // ---- sheet_read ----
      {
        name: 'list_sheets',
        description: '列出 Base 下可访问的工作表',
        group: 'sheet_read',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.sheets.listByBase(strArg(args, 'baseId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'get_sheet_schema',
        description: '获取工作表与字段 schema（含字段 id/类型）',
        group: 'sheet_read',
        inputSchema: {
          type: 'object',
          properties: { sheetId: { type: 'string' } },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.sheets.getSheet(strArg(args, 'sheetId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'query_records',
        description: '分页列出工作表记录；可用 views.query 做筛选排序时优先用 query_view',
        group: 'sheet_read',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            limit: { type: 'number', description: '默认 50，最大 200' },
            cursor: { type: 'string' },
            offset: { type: 'number' },
          },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.sheets.listRecords(
            strArg(args, 'sheetId', { required: true }),
            actor.userId,
            {
              limit: numArg(args, 'limit', { defaultValue: 50, min: 1, max: 200 }),
              cursor: strArg(args, 'cursor') || undefined,
              offset: args.offset === undefined ? undefined : numArg(args, 'offset', { min: 0 }),
            },
          ),
        ),
      },
      {
        name: 'query_view',
        description: '按 ViewQuery（筛选/排序/分页）查询工作表记录',
        group: 'sheet_read',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            query: {
              type: 'object',
              description: 'ViewQuery：filter/sorts/page/pageSize 等',
              additionalProperties: true,
            },
          },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.views.query(
            strArg(args, 'sheetId', { required: true }),
            actor.userId,
            (objArg(args, 'query') || {}) as ViewQuery,
          ),
        ),
      },
      {
        name: 'get_changes',
        description: '获取工作表自 fromRev 之后的 changeset（协同回放）',
        group: 'sheet_read',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            fromRev: { type: 'number', description: '默认 0' },
          },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const sheetId = strArg(args, 'sheetId', { required: true });
          await this.sheets.assertSheetAccess(sheetId, actor.userId, 'viewer');
          const fromRev = numArg(args, 'fromRev', { defaultValue: 0, min: 0 });
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
              mutations: r.mutations,
              createdAt: r.createdAt,
            })),
          };
        }),
      },
      {
        name: 'get_sheet_digest',
        description: '获取工作表摘要（字段 + 样本行），供分析/回答用',
        group: 'ai_meta',
        inputSchema: {
          type: 'object',
          properties: {
            sheetIds: {
              type: 'array',
              items: { type: 'string' },
              description: '一个或多个 sheetId',
            },
          },
          required: ['sheetIds'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const ids = arrArg(args, 'sheetIds', { required: true }).map(String);
          return this.digests.buildDigests(ids, actor.userId);
        }),
      },

      // ---- sheet_write ----
      {
        name: 'commit_sheet_changes',
        description:
          '通过 commitchanges 提交工作表变更（setRecord/createRecord/deleteRecord/createField 等）。每条 mutation 需 clientOpId；若缺省则服务端补齐。',
        group: 'sheet_write',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            mutations: {
              type: 'array',
              description: 'SheetMutation 数组',
              items: { type: 'object', additionalProperties: true },
            },
            clientBatchId: { type: 'string', description: '可选；默认自动生成' },
            expectedSheetRev: { type: 'number' },
          },
          required: ['sheetId', 'mutations'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const sheetId = strArg(args, 'sheetId', { required: true });
          const rawMutations = arrArg(args, 'mutations', { required: true });
          const mutations = rawMutations.map((item, index) => {
            const m = (item ?? {}) as Record<string, unknown>;
            const clientOpId =
              typeof m.clientOpId === 'string' && m.clientOpId.length >= 8
                ? m.clientOpId
                : newClientOpId(`m${index}`);
            return { ...m, clientOpId } as unknown as SheetMutation;
          });
          const clientBatchId =
            strArg(args, 'clientBatchId') || `batch_${randomUUID()}`;
          const expectedSheetRev =
            args.expectedSheetRev === undefined
              ? undefined
              : numArg(args, 'expectedSheetRev', { min: 0 });
          return this.commits.commit(
            sheetId,
            actor.userId,
            { clientBatchId, mutations: mutations as never },
            '0.0.0.0',
            expectedSheetRev,
          );
        }),
      },

      // ---- view ----
      {
        name: 'list_views',
        description: '列出工作表已保存视图',
        group: 'view',
        inputSchema: {
          type: 'object',
          properties: { sheetId: { type: 'string' } },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.views.listSaved(strArg(args, 'sheetId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'create_view',
        description: '创建已保存视图',
        group: 'view',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            name: { type: 'string' },
            query: { type: 'object', additionalProperties: true },
          },
          required: ['sheetId', 'name'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.views.createSaved(
            strArg(args, 'sheetId', { required: true }),
            actor.userId,
            {
              name: strArg(args, 'name', { required: true }),
              query: (objArg(args, 'query') || {}) as Record<string, unknown>,
            },
          ),
        ),
      },
      {
        name: 'update_view',
        description: '更新已保存视图',
        group: 'view',
        inputSchema: {
          type: 'object',
          properties: {
            viewId: { type: 'string' },
            name: { type: 'string' },
            query: { type: 'object', additionalProperties: true },
          },
          required: ['viewId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.views.updateSaved(
            strArg(args, 'viewId', { required: true }),
            actor.userId,
            {
              ...(args.name === undefined
                ? {}
                : { name: strArg(args, 'name', { required: true }) }),
              ...(args.query === undefined
                ? {}
                : { query: objArg(args, 'query') as Record<string, unknown> }),
            },
          ),
        ),
      },
      {
        name: 'delete_view',
        description: '删除已保存视图',
        group: 'view',
        inputSchema: {
          type: 'object',
          properties: { viewId: { type: 'string' } },
          required: ['viewId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.views.deleteSaved(strArg(args, 'viewId', { required: true }), actor.userId),
        ),
      },

      // ---- form ----
      {
        name: 'list_forms',
        description: '列出 Base 下表单',
        group: 'form',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.forms.listByBase(strArg(args, 'baseId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'get_form',
        description: '获取表单配置（所有者视角）',
        group: 'form',
        inputSchema: {
          type: 'object',
          properties: { formId: { type: 'string' } },
          required: ['formId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.forms.getForOwner(strArg(args, 'formId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'upsert_form',
        description: '更新表单配置（字段布局/成功页等）',
        group: 'form',
        inputSchema: {
          type: 'object',
          properties: {
            formId: { type: 'string' },
            patch: { type: 'object', additionalProperties: true, description: 'UpsertFormDto 字段' },
          },
          required: ['formId', 'patch'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.forms.upsert(
            strArg(args, 'formId', { required: true }),
            actor.userId,
            objArg(args, 'patch', { required: true }) as never,
          ),
        ),
      },

      // ---- automation ----
      {
        name: 'list_automations',
        description: '列出 Base 自动化',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.automations.list(actor.userId, strArg(args, 'baseId', { required: true })),
        ),
      },
      {
        name: 'get_automation',
        description: '获取自动化详情',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: { automationId: { type: 'string' } },
          required: ['automationId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.automations.get(
            actor.userId,
            strArg(args, 'automationId', { required: true }),
          ),
        ),
      },
      {
        name: 'create_automation',
        description: '创建自动化',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: {
            dto: { type: 'object', additionalProperties: true },
          },
          required: ['dto'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.automations.create(actor.userId, objArg(args, 'dto', { required: true }) as never),
        ),
      },
      {
        name: 'update_automation',
        description: '更新自动化定义',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: {
            automationId: { type: 'string' },
            dto: { type: 'object', additionalProperties: true },
          },
          required: ['automationId', 'dto'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.automations.update(
            actor.userId,
            strArg(args, 'automationId', { required: true }),
            objArg(args, 'dto', { required: true }) as never,
          ),
        ),
      },
      {
        name: 'run_automation',
        description: '手动触发自动化运行',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: {
            automationId: { type: 'string' },
            triggerRecordId: { type: 'string' },
          },
          required: ['automationId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const triggerRecordId = strArg(args, 'triggerRecordId') || undefined;
          return this.automations.runManually(
            actor.userId,
            strArg(args, 'automationId', { required: true }),
            triggerRecordId ? { triggerRecordId } : {},
          );
        }),
      },
      {
        name: 'list_automation_runs',
        description: '列出自动化运行历史',
        group: 'automation',
        inputSchema: {
          type: 'object',
          properties: {
            automationId: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['automationId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.automations.listRuns(
            actor.userId,
            strArg(args, 'automationId', { required: true }),
            numArg(args, 'limit', { defaultValue: 50, min: 1, max: 100 }),
          ),
        ),
      },

      // ---- dashboard ----
      {
        name: 'list_dashboards',
        description: '列出 Base 仪表盘',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            baseId: { type: 'string' },
            kind: { type: 'string' },
          },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.dashboards.list(
            strArg(args, 'baseId', { required: true }),
            actor.userId,
            strArg(args, 'kind') || undefined,
          ),
        ),
      },
      {
        name: 'get_dashboard',
        description: '获取仪表盘详情（含 widgets）',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: { dashboardId: { type: 'string' } },
          required: ['dashboardId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.dashboards.get(
            strArg(args, 'dashboardId', { required: true }),
            actor.userId,
          ),
        ),
      },
      {
        name: 'create_dashboard',
        description: '创建仪表盘',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            baseId: { type: 'string' },
            name: { type: 'string' },
            kind: { type: 'string' },
          },
          required: ['baseId', 'name'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.dashboards.create(
            strArg(args, 'baseId', { required: true }),
            actor.userId,
            strArg(args, 'name', { required: true }),
            strArg(args, 'kind') || 'dashboard',
          ),
        ),
      },
      {
        name: 'update_dashboard',
        description: '更新仪表盘元数据',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            dashboardId: { type: 'string' },
            patch: { type: 'object', additionalProperties: true },
          },
          required: ['dashboardId', 'patch'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.dashboards.update(
            strArg(args, 'dashboardId', { required: true }),
            actor.userId,
            objArg(args, 'patch', { required: true }) as never,
          ),
        ),
      },
      {
        name: 'upsert_widget',
        description: '新增或更新仪表盘组件；传 widgetId 则更新，否则新增',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            dashboardId: { type: 'string' },
            widgetId: { type: 'string' },
            widget: { type: 'object', additionalProperties: true },
          },
          required: ['dashboardId', 'widget'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const dashboardId = strArg(args, 'dashboardId', { required: true });
          const widget = objArg(args, 'widget', { required: true });
          const widgetId = strArg(args, 'widgetId');
          if (widgetId) {
            return this.dashboards.updateWidget(
              dashboardId,
              widgetId,
              actor.userId,
              widget as never,
            );
          }
          return this.dashboards.addWidget(dashboardId, actor.userId, widget as never);
        }),
      },
      {
        name: 'query_widget',
        description: '查询仪表盘组件数据',
        group: 'dashboard',
        inputSchema: {
          type: 'object',
          properties: {
            dashboardId: { type: 'string' },
            widgetId: { type: 'string' },
          },
          required: ['dashboardId', 'widgetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.dashboards.queryWidget(
            strArg(args, 'dashboardId', { required: true }),
            strArg(args, 'widgetId', { required: true }),
            actor.userId,
          ),
        ),
      },

      // ---- acl ----
      {
        name: 'get_permissions',
        description: '列出 Base 内容权限对象',
        group: 'acl',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.permissions.listForBase(
            strArg(args, 'baseId', { required: true }),
            actor.userId,
          ),
        ),
      },
      {
        name: 'get_permission_settings',
        description: '获取对象（sheet/form/dashboard）权限设置',
        group: 'acl',
        inputSchema: {
          type: 'object',
          properties: {
            objectType: { type: 'string', enum: ['sheet', 'form', 'dashboard'] },
            objectId: { type: 'string' },
          },
          required: ['objectType', 'objectId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.permissions.getSettings(
            strArg(args, 'objectType', { required: true }),
            strArg(args, 'objectId', { required: true }),
            actor.userId,
          ),
        ),
      },
      {
        name: 'put_permission_settings',
        description: '更新对象权限设置',
        group: 'acl',
        inputSchema: {
          type: 'object',
          properties: {
            objectType: { type: 'string', enum: ['sheet', 'form', 'dashboard'] },
            objectId: { type: 'string' },
            settings: { type: 'object', additionalProperties: true },
          },
          required: ['objectType', 'objectId', 'settings'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.permissions.updateSettings(
            strArg(args, 'objectType', { required: true }),
            strArg(args, 'objectId', { required: true }),
            actor.userId,
            objArg(args, 'settings', { required: true }) as never,
          ),
        ),
      },

      // ---- template ----
      {
        name: 'list_templates',
        description: '列出模板（scope=workspace|base）',
        group: 'template',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['workspace', 'base'] },
          },
          additionalProperties: false,
        },
        handler: w(async (args) => {
          const scope = strArg(args, 'scope', { defaultValue: 'workspace' });
          return this.templates.list(scope === 'base' ? 'base' : 'workspace');
        }),
      },
      {
        name: 'instantiate_template',
        description: '将模板实例化到工作区或 Base（templateKey 为模板目录 key）',
        group: 'template',
        inputSchema: {
          type: 'object',
          properties: {
            templateKey: { type: 'string' },
            workspaceId: { type: 'string' },
            baseId: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['templateKey'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const workspaceId = strArg(args, 'workspaceId');
          const baseId = strArg(args, 'baseId') || undefined;
          if (!workspaceId && !baseId) {
            throw new Error('workspaceId 或 baseId 不能为空');
          }
          return this.templates.instantiate(
            workspaceId,
            actor.userId,
            strArg(args, 'templateKey', { required: true }),
            strArg(args, 'name') || undefined,
            baseId,
          );
        }),
      },

      // ---- collab_meta ----
      {
        name: 'list_comments',
        description: '列出工作表评论',
        group: 'collab_meta',
        inputSchema: {
          type: 'object',
          properties: { sheetId: { type: 'string' } },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.comments.list(strArg(args, 'sheetId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'create_comment',
        description: '创建工作表评论',
        group: 'collab_meta',
        inputSchema: {
          type: 'object',
          properties: {
            sheetId: { type: 'string' },
            body: { type: 'string' },
            recordId: { type: 'string' },
            mentionUserIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['sheetId', 'body'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.comments.create(
            strArg(args, 'sheetId', { required: true }),
            actor.userId,
            strArg(args, 'body', { required: true }),
            arrArg(args, 'mentionUserIds').map(String),
          ),
        ),
      },
      {
        name: 'list_notifications',
        description: '列出当前用户通知',
        group: 'collab_meta',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number' } },
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const take = numArg(args, 'limit', { defaultValue: 50, min: 1, max: 200 });
          const notifications = await this.prisma.notification.findMany({
            where: { userId: actor.userId },
            orderBy: { createdAt: 'desc' },
            take,
          });
          return { notifications };
        }),
      },
      {
        name: 'mark_notifications_read',
        description: '标记通知已读；不传 notificationId 则全部已读',
        group: 'collab_meta',
        inputSchema: {
          type: 'object',
          properties: { notificationId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const notificationId = strArg(args, 'notificationId');
          if (notificationId) {
            const updated = await this.prisma.notification.updateMany({
              where: { id: notificationId, userId: actor.userId },
              data: { readAt: new Date() },
            });
            if (updated.count > 0) {
              await this.live.emit({
                baseId: null,
                actorId: actor.userId,
                kind: 'notification.read',
                entityId: notificationId,
                userId: actor.userId,
              });
            }
            return { read: true, count: updated.count };
          }
          const updated = await this.prisma.notification.updateMany({
            where: { userId: actor.userId, readAt: null },
            data: { readAt: new Date() },
          });
          if (updated.count > 0) {
            await this.live.emit({
              baseId: null,
              actorId: actor.userId,
              kind: 'notification.read',
              userId: actor.userId,
              meta: { all: true, count: updated.count },
            });
          }
          return { read: true, count: updated.count };
        }),
      },

      // ---- share ----
      {
        name: 'list_public_views',
        description: '列出工作表公开视图分享',
        group: 'share',
        inputSchema: {
          type: 'object',
          properties: { sheetId: { type: 'string' } },
          required: ['sheetId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.publicViews.list(strArg(args, 'sheetId', { required: true }), actor.userId),
        ),
      },
      {
        name: 'manage_public_view',
        description: '创建/更新/删除公开视图。action=create|update|delete',
        group: 'share',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete'] },
            sheetId: { type: 'string' },
            viewId: { type: 'string' },
            body: { type: 'object', additionalProperties: true },
          },
          required: ['action'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) => {
          const action = strArg(args, 'action', { required: true });
          if (action === 'create') {
            return this.publicViews.create(
              strArg(args, 'sheetId', { required: true }),
              actor.userId,
              objArg(args, 'body', { required: true }) as never,
            );
          }
          if (action === 'update') {
            return this.publicViews.update(
              strArg(args, 'viewId', { required: true }),
              actor.userId,
              objArg(args, 'body', { required: true }) as never,
            );
          }
          if (action === 'delete') {
            return this.publicViews.remove(
              strArg(args, 'viewId', { required: true }),
              actor.userId,
            );
          }
          throw new Error(`未知 action: ${action}`);
        }),
      },

      // ---- ai_meta ----
      {
        name: 'list_analysis_reports',
        description: '列出 Base 分析报告',
        group: 'ai_meta',
        inputSchema: {
          type: 'object',
          properties: { baseId: { type: 'string' } },
          required: ['baseId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.analysis.list(strArg(args, 'baseId', { required: true }), actor.userId),
        ),
      },

      // ---- quota ----
      {
        name: 'get_workspace_quota',
        description: '获取工作区配额使用情况',
        group: 'quota',
        inputSchema: {
          type: 'object',
          properties: { workspaceId: { type: 'string' } },
          required: ['workspaceId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.quotas.get(strArg(args, 'workspaceId', { required: true }), actor.userId),
        ),
      },

      // ---- admin (installAdmin only) ----
      {
        name: 'admin_list_users',
        description: '【管理员】列出用户',
        group: 'admin',
        adminOnly: true,
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.adminUsers.list(
            actor.userId,
            strArg(args, 'q') || undefined,
            strArg(args, 'identity') || undefined,
          ),
        ),
      },
      {
        name: 'admin_unlock_login',
        description: '【管理员】解锁用户登录锁定',
        group: 'admin',
        adminOnly: true,
        inputSchema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.adminUsers.unlockLogin(
            actor.userId,
            strArg(args, 'userId', { required: true }),
          ),
        ),
      },
      {
        name: 'admin_set_blacklist',
        description: '【管理员】拉黑或解除拉黑用户',
        group: 'admin',
        adminOnly: true,
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            blacklisted: { type: 'boolean' },
          },
          required: ['userId', 'blacklisted'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.adminUsers.setBlacklisted(
            actor.userId,
            strArg(args, 'userId', { required: true }),
            Boolean(args.blacklisted),
          ),
        ),
      },
      {
        name: 'admin_send_message',
        description: '【管理员】向用户发送站内消息',
        group: 'admin',
        adminOnly: true,
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['userId', 'body'],
          additionalProperties: false,
        },
        handler: w(async (args, actor) =>
          this.adminUsers.sendMessage(
            actor.userId,
            strArg(args, 'userId', { required: true }),
            strArg(args, 'body', { required: true }),
          ),
        ),
      },
    ];
  }
}
