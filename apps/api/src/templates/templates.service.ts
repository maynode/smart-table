import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  OBJECT_KIND_LABEL,
  OBJECT_TEMPLATE_CATALOG,
  type ObjectTemplateDefinition,
  type ObjectTemplateKind,
} from './object-templates';

interface TemplateFieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

interface TemplateSheetDefinition {
  name: string;
  fields: TemplateFieldDefinition[];
  records?: Array<Record<string, unknown>>;
}

export interface TemplateDefinition {
  key: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  sheets: TemplateSheetDefinition[];
  serialClaim?: boolean;
}

export const TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    key: 'serial-claim',
    name: '序列号领取',
    category: '运营',
    icon: '🎟️',
    description:
      '码库 + 收集表单 + 联动修改自动化，一客一码、并发安全领取，并生成分享链接。',
    serialClaim: true,
    sheets: [
      {
        name: '码库',
        fields: [
          { name: '序列号', type: 'text' },
          {
            name: '状态',
            type: 'select',
            options: {
              choices: [
                { id: 'unclaimed', name: '未领', color: 'gray' },
                { id: 'claimed', name: '已领', color: 'green' },
              ],
            },
          },
          { name: '领取手机号', type: 'phone' },
          { name: '领取时间', type: 'date' },
        ],
      },
      {
        name: '收集表单',
        fields: [
          { name: '手机号', type: 'phone', required: true },
          { name: '备注', type: 'text' },
        ],
      },
    ],
  },
  {
    key: 'customer-crm',
    name: '客户管理',
    category: '销售',
    icon: '🤝',
    description: '客户档案、跟进记录与销售阶段，适合私域/大客户团队。',
    sheets: [
      {
        name: '客户',
        fields: [
          { name: '客户名称', type: 'text', required: true },
          { name: '联系人', type: 'text' },
          { name: '手机号', type: 'phone' },
          {
            name: '阶段',
            type: 'select',
            options: {
              choices: [
                { id: 'lead', name: '线索', color: 'gray' },
                { id: 'active', name: '跟进中', color: 'blue' },
                { id: 'won', name: '已成交', color: 'green' },
              ],
            },
          },
          { name: '预计金额', type: 'currency' },
        ],
        records: [
          {
            客户名称: '晨光科技',
            联系人: '王经理',
            阶段: 'active',
            预计金额: 120000,
          },
          {
            客户名称: '云帆供应链',
            联系人: '李总',
            阶段: 'lead',
            预计金额: 80000,
          },
        ],
      },
    ],
  },
  {
    key: 'project-tasks',
    name: '项目任务',
    category: '项目',
    icon: '🗂️',
    description: '任务拆分、负责人、优先级与截止日期，一张表推进交付。',
    sheets: [
      {
        name: '任务',
        fields: [
          { name: '任务', type: 'text', required: true },
          { name: '负责人', type: 'text' },
          {
            name: '优先级',
            type: 'select',
            options: {
              choices: [
                { id: 'p0', name: 'P0', color: 'red' },
                { id: 'p1', name: 'P1', color: 'yellow' },
                { id: 'p2', name: 'P2', color: 'gray' },
              ],
            },
          },
          { name: '截止日期', type: 'date' },
          { name: '完成', type: 'checkbox' },
        ],
        records: [
          { 任务: '需求评审', 优先级: 'p0', 完成: false },
          { 任务: '开发联调', 优先级: 'p1', 完成: false },
        ],
      },
    ],
  },
];

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly live: LiveBusService,
  ) {}

  list(scope: 'workspace' | 'base' = 'workspace') {
    if (scope === 'base') {
      return OBJECT_TEMPLATE_CATALOG.map((template) => ({
        key: template.key,
        name: template.name,
        category: OBJECT_KIND_LABEL[template.kind],
        kind: template.kind,
        icon: template.icon,
        description: template.description,
        sheets: template.fields
          ? [{ name: template.name, fields: template.fields.length }]
          : [],
      }));
    }
    return TEMPLATE_CATALOG.map((template) => ({
      key: template.key,
      name: template.name,
      category: template.category,
      kind: 'base' as const,
      icon: template.icon,
      description: template.description,
      sheets: template.sheets.map((sheet) => ({
        name: sheet.name,
        fields: sheet.fields.length,
      })),
    }));
  }

  async instantiate(
    workspaceId: string,
    userId: string,
    key: string,
    name?: string | null,
    baseId?: string | null,
  ) {
    const objectTemplate = OBJECT_TEMPLATE_CATALOG.find(
      (item) => item.key === key,
    );
    if (objectTemplate) {
      if (!baseId) {
        throw new BadRequestException('对象模板需要 baseId');
      }
      const created = await this.instantiateIntoBase(
        baseId,
        userId,
        objectTemplate,
        name,
      );
      await this.emitInstantiateLive(created, userId, workspaceId);
      return created;
    }

    await this.workspaces.requireMember(workspaceId, userId, 'editor');
    const template = TEMPLATE_CATALOG.find((item) => item.key === key);
    if (!template) throw new BadRequestException('模板不存在');
    const baseName = (name ?? '').trim() || template.name;
    await this.assertBaseNameAvailable(workspaceId, baseName);
    const created = template.serialClaim
      ? await this.instantiateSerialClaim(workspaceId, template, baseName)
      : await this.instantiateSimple(workspaceId, template, baseName);
    await this.emitInstantiateLive(created, userId, workspaceId);
    return created;
  }

  private async emitInstantiateLive(
    created: Record<string, unknown>,
    actorId: string,
    workspaceId: string,
  ): Promise<void> {
    const baseId =
      typeof created.baseId === 'string' ? created.baseId : null;
    if (!baseId) return;

    if (created.kind === undefined || created.kind === 'base') {
      await this.live.emit({
        baseId,
        workspaceId,
        actorId,
        kind: 'base.created',
        entityId: baseId,
        meta: {
          name: typeof created.name === 'string' ? created.name : undefined,
          template:
            typeof created.template === 'string' ? created.template : undefined,
        },
      });
    }

    if (typeof created.sheetId === 'string') {
      await this.live.emit({
        baseId,
        actorId,
        kind: 'sheet.created',
        entityId: created.sheetId,
        meta: {
          name: typeof created.name === 'string' ? created.name : undefined,
        },
      });
    }
    if (Array.isArray(created.sheets)) {
      for (const sheet of created.sheets) {
        if (!sheet || typeof sheet !== 'object') continue;
        const id = (sheet as { id?: unknown }).id;
        const name = (sheet as { name?: unknown }).name;
        if (typeof id !== 'string') continue;
        await this.live.emit({
          baseId,
          actorId,
          kind: 'sheet.created',
          entityId: id,
          meta: { name: typeof name === 'string' ? name : undefined },
        });
      }
    }
    if (typeof created.formId === 'string') {
      await this.live.emit({
        baseId,
        actorId,
        kind: 'form.created',
        entityId: created.formId,
        meta: {
          name: typeof created.name === 'string' ? created.name : undefined,
        },
      });
    }
    if (typeof created.dashboardId === 'string') {
      await this.live.emit({
        baseId,
        actorId,
        kind: 'dashboard.created',
        entityId: created.dashboardId,
        meta: {
          name: typeof created.name === 'string' ? created.name : undefined,
        },
      });
    }
    if (typeof created.reportId === 'string') {
      await this.live.emit({
        baseId,
        actorId,
        kind: 'analysis.created',
        entityId: created.reportId,
        meta: {
          name: typeof created.name === 'string' ? created.name : undefined,
        },
      });
    }
    await this.live.emit({
      baseId,
      workspaceId,
      actorId,
      kind: 'template.changed',
      entityId: baseId,
      meta: {
        template:
          typeof created.template === 'string' ? created.template : undefined,
        kind: created.kind,
      },
    });
  }

  private async instantiateIntoBase(
    baseId: string,
    userId: string,
    template: ObjectTemplateDefinition,
    name?: string | null,
  ) {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new BadRequestException('Base 不存在');
    await this.workspaces.requireMember(base.workspaceId, userId, 'editor');
    const objectName = (name ?? '').trim() || template.name;

    if (template.kind === 'sheet' || template.kind === 'form') {
      return this.instantiateSheetOrForm(base.id, userId, template, objectName);
    }
    if (template.kind === 'dashboard') {
      const dashboard = await this.prisma.dashboard.create({
        data: {
          baseId: base.id,
          name: objectName,
          kind: 'dashboard',
          createdBy: userId,
        },
      });
      return {
        template: template.key,
        kind: 'dashboard' as ObjectTemplateKind,
        baseId: base.id,
        dashboardId: dashboard.id,
        name: dashboard.name,
      };
    }
    if (template.kind === 'report') {
      const sheets = await this.prisma.sheet.findMany({
        where: { baseId: base.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      });
      const now = new Date().toISOString();
      const messages =
        sheets.length === 0
          ? [
              {
                id: randomUUID(),
                role: 'assistant',
                content: '当前文档还没有工作表，请先新建表格后再试。',
                kind: 'text',
                createdAt: now,
              },
            ]
          : [
              {
                id: randomUUID(),
                role: 'assistant',
                content:
                  sheets.length === 1
                    ? `当前文档包含工作表「${sheets[0]!.name}」。确认后我将开始分析。`
                    : `当前文档包含 ${sheets.length} 张表，您想分析哪张表的数据？`,
                kind: sheets.length <= 1 ? 'text' : 'choice',
                options:
                  sheets.length <= 1
                    ? undefined
                    : [
                        ...sheets.map((s) => ({
                          id: `sheet:${s.id}`,
                          label: s.name,
                        })),
                        {
                          id: 'all',
                          label: `综合/全景（${sheets.length} 张表都看）`,
                        },
                        { id: 'other', label: '请输入其他…' },
                      ],
                createdAt: now,
              },
            ];
      const sheetIds = sheets.length === 1 ? [sheets[0]!.id] : [];
      const report = await this.prisma.analysisReport.create({
        data: {
          baseId: base.id,
          name: objectName,
          status: sheets.length === 0 ? 'failed' : 'asking',
          messages: messages as unknown as Prisma.InputJsonValue,
          steps: [] as unknown as Prisma.InputJsonValue,
          sheetIds: sheetIds as unknown as Prisma.InputJsonValue,
          createdBy: userId,
          error: sheets.length === 0 ? '没有可分析的工作表' : null,
        },
      });
      return {
        template: template.key,
        kind: 'report' as ObjectTemplateKind,
        baseId: base.id,
        reportId: report.id,
        name: report.name,
      };
    }
    throw new BadRequestException('不支持的模板类型');
  }

  private async instantiateSheetOrForm(
    baseId: string,
    userId: string,
    template: ObjectTemplateDefinition,
    objectName: string,
  ) {
    const fields = template.fields ?? [];
    const result = await this.prisma.$transaction(async (tx) => {
      const sheet = await tx.sheet.create({
        data: { baseId, name: objectName },
      });
      const fieldMap = new Map<string, string>();
      const fieldIds: string[] = [];
      for (const [order, field] of fields.entries()) {
        const created = await tx.field.create({
          data: {
            sheetId: sheet.id,
            name: field.name,
            type: field.type,
            required: field.required ?? false,
            order,
            options: (field.options ?? {}) as Prisma.InputJsonValue,
          },
        });
        fieldMap.set(field.name, created.id);
        fieldIds.push(created.id);
      }
      for (const record of template.records ?? []) {
        const cells: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(record)) {
          const fieldId = fieldMap.get(name);
          if (fieldId) cells[fieldId] = value;
        }
        await tx.recordRow.create({
          data: {
            sheetId: sheet.id,
            cells: cells as Prisma.InputJsonValue,
            createdBy: userId,
          },
        });
      }

      let formId: string | undefined;
      if (template.kind === 'form') {
        const shareToken = randomBytes(12).toString('base64url');
        const form = await tx.form.create({
          data: {
            baseId,
            sheetId: sheet.id,
            name: objectName,
            shareToken,
            fields: fieldIds.map((fieldId) => ({
              fieldId,
              required:
                fields.find((f) => fieldMap.get(f.name) === fieldId)
                  ?.required ?? false,
            })) as Prisma.InputJsonValue,
            share: {
              enabled: true,
              audience: 'anyone',
              expiresAt: null,
            } as Prisma.InputJsonValue,
            successTemplate: template.successTemplate ?? '',
            rejectDuplicatePhone: true,
          },
        });
        formId = form.id;
      }

      return { sheetId: sheet.id, formId, name: sheet.name };
    });

    return {
      template: template.key,
      kind: template.kind,
      baseId,
      sheetId: result.sheetId,
      formId: result.formId,
      name: result.name,
    };
  }

  private async assertBaseNameAvailable(
    workspaceId: string,
    name: string,
  ): Promise<void> {
    const rows = await this.prisma.base.findMany({
      where: { workspaceId },
      select: { name: true },
    });
    const needle = name.trim().toLowerCase();
    const clash = rows.find(
      (item) => item.name.trim().toLowerCase() === needle,
    );
    if (clash) {
      throw new ConflictException(`当前工作区已存在同名表格「${clash.name}」`);
    }
  }

  private async instantiateSimple(
    workspaceId: string,
    template: TemplateDefinition,
    baseName?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const max = await tx.base.aggregate({
        where: { workspaceId },
        _max: { sortOrder: true },
      });
      const base = await tx.base.create({
        data: {
          workspaceId,
          name: baseName ?? template.name,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
      const sheets: Array<{ id: string; name: string }> = [];
      for (const sheetDefinition of template.sheets) {
        const sheet = await tx.sheet.create({
          data: { baseId: base.id, name: sheetDefinition.name },
        });
        sheets.push({ id: sheet.id, name: sheet.name });
        const fieldMap = new Map<string, string>();
        for (const [order, field] of sheetDefinition.fields.entries()) {
          const created = await tx.field.create({
            data: {
              sheetId: sheet.id,
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              order,
              options: (field.options ?? {}) as Prisma.InputJsonValue,
            },
          });
          fieldMap.set(field.name, created.id);
        }
        for (const record of sheetDefinition.records ?? []) {
          const cells: Record<string, unknown> = {};
          for (const [name, value] of Object.entries(record)) {
            const fieldId = fieldMap.get(name);
            if (fieldId) cells[fieldId] = value;
          }
          await tx.recordRow.create({
            data: {
              sheetId: sheet.id,
              cells: cells as Prisma.InputJsonValue,
              createdBy: null,
            },
          });
        }
      }
      return { baseId: base.id, sheets };
    });
    return { template: template.key, ...result };
  }

  private async instantiateSerialClaim(
    workspaceId: string,
    template: TemplateDefinition,
    baseName?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const max = await tx.base.aggregate({
        where: { workspaceId },
        _max: { sortOrder: true },
      });
      const base = await tx.base.create({
        data: {
          workspaceId,
          name: baseName ?? template.name,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
      const codeSheet = await tx.sheet.create({
        data: { baseId: base.id, name: '码库' },
      });
      const formSheet = await tx.sheet.create({
        data: { baseId: base.id, name: '收集表单' },
      });

      const serial = await tx.field.create({
        data: { sheetId: codeSheet.id, name: '序列号', type: 'text', order: 0 },
      });
      const status = await tx.field.create({
        data: {
          sheetId: codeSheet.id,
          name: '状态',
          type: 'select',
          order: 1,
          options: {
            choices: [
              { id: 'unclaimed', name: '未领', color: 'gray' },
              { id: 'claimed', name: '已领', color: 'green' },
            ],
          },
        },
      });
      const claimedPhone = await tx.field.create({
        data: {
          sheetId: codeSheet.id,
          name: '领取手机号',
          type: 'phone',
          order: 2,
        },
      });
      const claimedAt = await tx.field.create({
        data: {
          sheetId: codeSheet.id,
          name: '领取时间',
          type: 'date',
          order: 3,
        },
      });
      // 对齐企微「序列号领取」收集表单：默认仅手机号（备注可自行在编辑表单里加）
      const phone = await tx.field.create({
        data: {
          sheetId: formSheet.id,
          name: '手机号',
          type: 'phone',
          order: 0,
          required: true,
        },
      });

      for (let index = 1; index <= 100; index += 1) {
        await tx.recordRow.create({
          data: {
            sheetId: codeSheet.id,
            claimStatus: 'unclaimed',
            cells: {
              [serial.id]: `SN-${String(index).padStart(4, '0')}`,
              [status.id]: 'unclaimed',
            } as Prisma.InputJsonValue,
          },
        });
      }

      const formId = randomUUID();
      const shareToken = randomBytes(12).toString('base64url');
      await tx.form.create({
        data: {
          id: formId,
          baseId: base.id,
          sheetId: formSheet.id,
          name: '序列号领取',
          shareToken,
          fields: [{ fieldId: phone.id, required: true }] as Prisma.InputJsonValue,
          share: {
            enabled: true,
            audience: 'anyone',
            expiresAt: null,
          } as Prisma.InputJsonValue,
          successTemplate: '',
          rejectDuplicatePhone: true,
          duplicateCheckFieldId: phone.id,
        },
      });
      // 查找 → 修改 → 发送消息给填写者（成功页用 消息内容；匿名填写不投递给管理员）
      await tx.automation.create({
        data: {
          baseId: base.id,
          name: '联动修改：领取序列号',
          enabled: true,
          trigger: {
            type: 'recordCreated',
            sheetId: formSheet.id,
            filters: {
              conjunction: 'and',
              conditions: [{ fieldId: phone.id, operator: 'isNotEmpty' }],
            },
          } as Prisma.InputJsonValue,
          steps: [
            {
              id: 'find-code',
              type: 'findRecords',
              sheetId: codeSheet.id,
              limit: 1,
              onEmpty: 'stop',
              filters: {
                conjunction: 'and',
                conditions: [
                  {
                    fieldId: status.id,
                    operator: 'equals',
                    value: 'unclaimed',
                  },
                ],
              },
            },
            {
              id: 'claim-code',
              type: 'modifyRecords',
              target: { mode: 'fromStep', stepId: 'find-code' },
              cells: {
                [status.id]: { kind: 'literal', value: 'claimed' },
                [claimedPhone.id]: {
                  kind: 'variable',
                  variable: { source: 'trigger', field: '手机号' },
                },
                [claimedAt.id]: {
                  kind: 'variable',
                  variable: { source: 'naturalTime', naturalTime: 'now' },
                },
              },
            },
            {
              id: 'notify-claimer',
              type: 'sendMessage',
              name: '你的序列号为',
              channel: 'doc',
              recipients: [{ source: 'trigger', field: '填写者' }],
              content: {
                text: '{{第3步.序列号}}',
                buttons: [],
              },
            },
          ] as Prisma.InputJsonValue,
          onFindEmpty: 'stop',
        },
      });

      return {
        baseId: base.id,
        sheets: [
          { id: codeSheet.id, name: codeSheet.name },
          { id: formSheet.id, name: formSheet.name },
        ],
        formId,
        shareToken,
        codes: 100,
      };
    });
    const publicBase = (
      process.env.PUBLIC_FORM_BASE_URL ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    return {
      template: template.key,
      ...result,
      shareUrl: `${publicBase}/fill/${result.shareToken}`,
    };
  }
}
